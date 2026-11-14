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

export async function processMessage(id: string, content: string) {
  const conversation = await getConversation(id);
  if (!conversation) return NextResponse.json({ detail: "Conversation not found." }, { status: 404 });
  const dataset = await getDatasetByConnection(conversation.connection_id);
  if (!dataset) return NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  const intent = { ...(await understandIntent(content, dataset.tables, conversation.intent)), request: content };
  await saveConversation(id, conversation.connection_id, intent);
  const missing = Array.isArray(intent.missing_information) ? intent.missing_information : [];
  if (missing.length) return NextResponse.json({ status: "clarification_required", conversation_id: id, message: "I found a specific ambiguity that changes the result.", questions: await clarify(intent, dataset.tables), dataset_name: dataset.name });
  const generated = await generateSql(intent, dataset.tables);
  const query = validateQuery(generated, dataset);
  const rows = await sql.unsafe(query);
  const explanation = await explain(query, rows as Record<string, unknown>[], dataset.name);
  await saveQuery(crypto.randomUUID(), id, content, query, "success");
  return NextResponse.json({ status: "completed", conversation_id: id, message: "Query completed.", sql: query, columns: rows.length ? Object.keys(rows[0]) : [], rows, explanation, dataset_name: dataset.name, validation_status: "valid" });
}
