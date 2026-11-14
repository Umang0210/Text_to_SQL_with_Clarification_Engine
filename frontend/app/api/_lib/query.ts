import { NextResponse } from "next/server";
import { clarify, explain, generateSql, understandIntent } from "./ai";
import { getConversation, getDatasetByConnection, saveConversation, saveQuery, sql } from "./db";
import type { Dataset, SchemaTable } from "./types";

const queryDeadlineMs = Number(process.env.QUERY_DEADLINE_MS ?? 25_000);

class QueryDeadlineError extends Error {
  constructor(stage: string) {
    super(`Query deadline expired during ${stage}.`);
    this.name = "QueryDeadlineError";
  }
}

async function runStage<T>(stage: string, operation: () => Promise<T>, deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new QueryDeadlineError(stage);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new QueryDeadlineError(stage)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTextType(type: string) {
  return /^(text|varchar|character varying|char|character|citext)/i.test(type.trim());
}

function columnName(expression: string) {
  const identifier = expression.trim().replace(/^.*\./, "").replace(/^"|"$/g, "");
  return identifier.toLowerCase();
}

function textColumns(dataset: Dataset) {
  return new Set(dataset.tables.flatMap((table) => table.columns.filter((column) => isTextType(column.type)).map((column) => column.name.toLowerCase())));
}

export function normalizeCaseInsensitiveTextComparisons(query: string, dataset: Dataset) {
  const columns = textColumns(dataset);
  const isTextColumn = (expression: string) => columns.has(columnName(expression)) && !/^\s*lower\s*\(/i.test(expression);
  let normalized = query;

  normalized = normalized.replace(
    /(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))\s*(=|<>|!=|LIKE|NOT\s+LIKE)\s*('(?:''|[^'])*')/gi,
    (match, left: string, operator: string, literal: string) => {
      if (!isTextColumn(left)) return match;
      const caseInsensitiveOperator = operator.replace(/\s+/g, " ").toUpperCase().replace("LIKE", "ILIKE");
      if (caseInsensitiveOperator === "=" || caseInsensitiveOperator === "<>" || caseInsensitiveOperator === "!=") {
        return `LOWER(${left}) ${caseInsensitiveOperator} LOWER(${literal})`;
      }
      return `${left} ${caseInsensitiveOperator} ${literal}`;
    },
  );

  normalized = normalized.replace(
    /('(?:''|[^'])*')\s*(=|<>|!=|LIKE|NOT\s+LIKE)\s*(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))/gi,
    (match, literal: string, operator: string, right: string) => {
      if (!isTextColumn(right)) return match;
      const caseInsensitiveOperator = operator.replace(/\s+/g, " ").toUpperCase().replace("LIKE", "ILIKE");
      if (caseInsensitiveOperator === "=" || caseInsensitiveOperator === "<>" || caseInsensitiveOperator === "!=") {
        return `LOWER(${literal}) ${caseInsensitiveOperator} LOWER(${right})`;
      }
      return `${literal} ${caseInsensitiveOperator} ${right}`;
    },
  );

  normalized = normalized.replace(
    /(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))\s*=\s*(\b(?:(?:[a-z_]\w*)\.)?(?:"[^"]+"|[a-z_]\w*))/gi,
    (match, left: string, right: string) => isTextColumn(left) && isTextColumn(right)
      ? `LOWER(${left}) = LOWER(${right})`
      : match,
  );
  return normalized;
}

function validateQuery(query: string, dataset: Awaited<ReturnType<typeof getDatasetByConnection>>) {
  const normalized = normalizeCaseInsensitiveTextComparisons(query.trim().replace(/;+\s*$/, ""), dataset as Dataset);
  if (!/^select\b/i.test(normalized) || /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i.test(normalized)) throw new Error("Only read-only SELECT queries are allowed.");
  if (!dataset) throw new Error("Query does not reference the active dataset schema.");
  const referencedTables = [...normalized.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi)].map((match) => match[1].toLowerCase());
  const knownTables = new Set(dataset.tables.map((table) => table.table.toLowerCase()));
  if (referencedTables.some((table) => !knownTables.has(table))) throw new Error("Query references a table outside the active dataset schema.");
  return /\blimit\s+\d+\b/i.test(normalized) ? normalized : `${normalized} LIMIT 500`;
}

export async function processMessage(id: string, content: string, requestId = crypto.randomUUID()) {
  const started = Date.now();
  const deadline = started + queryDeadlineMs;
  const stage = (name: string) => console.info("query_stage", { requestId, stage: name, durationMs: Date.now() - started });
  const conversation = await runStage("conversation lookup", () => getConversation(id), deadline);
  if (!conversation) return NextResponse.json({ detail: "Conversation not found." }, { status: 404 });
  const dataset = await runStage("dataset lookup", () => getDatasetByConnection(conversation.connection_id), deadline);
  if (!dataset) return NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  const intent = { ...(await runStage("intent generation", () => understandIntent(content, dataset.tables, conversation.intent, requestId), deadline)), request: content };
  stage("intent");
  await runStage("conversation persistence", () => saveConversation(id, conversation.connection_id, intent), deadline);
  const missing = Array.isArray(intent.missing_information) ? intent.missing_information : [];
  if (missing.length) return NextResponse.json({ status: "clarification_required", conversation_id: id, message: "I found a specific ambiguity that changes the result.", questions: await runStage("clarification generation", () => clarify(intent, dataset.tables, requestId), deadline), dataset_name: dataset.name });
  const generated = await runStage("SQL generation", () => generateSql(intent, dataset.tables, requestId), deadline);
  stage("sql_generation");
  const query = validateQuery(generated, dataset);
  let rows;
  try {
    rows = await runStage("PostgreSQL execution", () => sql.unsafe(query), deadline);
    stage("execution");
  } catch (error) {
    console.error("query_execution_failed", { requestId, query, durationMs: Date.now() - started, message: error instanceof Error ? error.message : "Unknown database error" });
    try { await saveQuery(crypto.randomUUID(), id, content, query, "failed"); } catch (historyError) { console.error("query_history_failed", { requestId, message: historyError instanceof Error ? historyError.message : "Unknown history error" }); }
    throw new Error(`Database query failed: ${error instanceof Error ? error.message : "Unknown database error"}`);
  }
  await runStage("query history persistence", () => saveQuery(crypto.randomUUID(), id, content, query, "success"), deadline);
  let explanation = `Returned ${rows.length} row(s) from ${dataset.name}.`;
  try {
    explanation = await runStage("result explanation", () => explain(query, (rows as Record<string, unknown>[]).slice(0, 50), dataset.name, requestId), deadline);
  } catch (error) {
    console.error("query_explanation_failed", { requestId, message: error instanceof Error ? error.message : "Unknown explanation error" });
  }
  stage("complete");
  return NextResponse.json({ status: "completed", conversation_id: id, message: "Query completed.", sql: query, columns: rows.length ? Object.keys(rows[0]) : [], rows, explanation, dataset_name: dataset.name, validation_status: "valid" });
}
