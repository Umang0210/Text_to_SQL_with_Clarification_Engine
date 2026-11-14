import { NextResponse } from "next/server";
import { clarify, explain, generateSql, understandIntent } from "./ai";
import { getConversation, getDatasetByConnection, saveConversation, saveQuery, sql } from "./db";

function validateQuery(query: string, dataset: Awaited<ReturnType<typeof getDatasetByConnection>>) {
  const normalized = query.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(normalized) || /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i.test(normalized)) throw new Error("Only read-only SELECT queries are allowed.");
  if (!dataset) throw new Error("Query does not reference the active dataset schema.");
  const referencedTables = [...normalized.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi)].map((match) => match[1].toLowerCase());
  const knownTables = new Set(dataset.tables.map((table) => table.table.toLowerCase()));
  if (referencedTables.some((table) => !knownTables.has(table))) throw new Error("Query references a table outside the active dataset schema.");
  return /\blimit\s+\d+\b/i.test(normalized) ? normalized : `${normalized} LIMIT 500`;
}

export async function processMessage(id: string, content: string, requestId = crypto.randomUUID()) {
  const started = Date.now();
  const stage = (name: string) => console.info("query_stage", { requestId, stage: name, durationMs: Date.now() - started });
  const conversation = await getConversation(id);
  if (!conversation) return NextResponse.json({ detail: "Conversation not found." }, { status: 404 });
  const dataset = await getDatasetByConnection(conversation.connection_id);
  if (!dataset) return NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  const intent = { ...(await understandIntent(content, dataset.tables, conversation.intent, requestId)), request: content };
  stage("intent");
  await saveConversation(id, conversation.connection_id, intent);
  const missing = Array.isArray(intent.missing_information) ? intent.missing_information : [];
  if (missing.length) return NextResponse.json({ status: "clarification_required", conversation_id: id, message: "I found a specific ambiguity that changes the result.", questions: await clarify(intent, dataset.tables, requestId), dataset_name: dataset.name });
  const generated = await generateSql(intent, dataset.tables, requestId);
  stage("sql_generation");
  const query = validateQuery(generated, dataset);
  let rows;
  try {
    rows = await sql.unsafe(query);
    stage("execution");
  } catch (error) {
    console.error("query_execution_failed", { requestId, query, durationMs: Date.now() - started, message: error instanceof Error ? error.message : "Unknown database error" });
    try { await saveQuery(crypto.randomUUID(), id, content, query, "failed"); } catch (historyError) { console.error("query_history_failed", { requestId, message: historyError instanceof Error ? historyError.message : "Unknown history error" }); }
    throw new Error(`Database query failed: ${error instanceof Error ? error.message : "Unknown database error"}`);
  }
  await saveQuery(crypto.randomUUID(), id, content, query, "success");
  let explanation = `Returned ${rows.length} row(s) from ${dataset.name}.`;
  try {
    explanation = await explain(query, rows as Record<string, unknown>[], dataset.name, requestId);
  } catch (error) {
    console.error("query_explanation_failed", { requestId, message: error instanceof Error ? error.message : "Unknown explanation error" });
  }
  stage("complete");
  return NextResponse.json({ status: "completed", conversation_id: id, message: "Query completed.", sql: query, columns: rows.length ? Object.keys(rows[0]) : [], rows, explanation, dataset_name: dataset.name, validation_status: "valid" });
}
