import postgres from "postgres";
import type { Dataset, Intent, SchemaTable } from "./types";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") {
  console.warn("DATABASE_URL is not configured; QueryMind API routes cannot persist data.");
}

export const sql = postgres(connectionString || "postgres://localhost/querymind", {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

export async function ensureDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS querymind_datasets (
      id text PRIMARY KEY,
      connection_id text NOT NULL,
      name text NOT NULL,
      filename text NOT NULL,
      size_bytes integer NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL,
      table_names text[] NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS querymind_conversations (
      id text PRIMARY KEY,
      connection_id text NOT NULL,
      intent jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS querymind_queries (
      id text PRIMARY KEY,
      conversation_id text NOT NULL,
      request text NOT NULL,
      generated_sql text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function getDataset(id: string): Promise<Dataset | null> {
  await ensureDatabase();
  const rows = await sql`SELECT * FROM querymind_datasets WHERE id = ${id}`;
  if (!rows[0]) return null;
  return rows[0].metadata as Dataset;
}

export async function getDatasetByConnection(connectionId: string): Promise<Dataset | null> {
  await ensureDatabase();
  const rows = await sql`SELECT * FROM querymind_datasets WHERE connection_id = ${connectionId}`;
  return rows[0] ? (rows[0].metadata as Dataset) : null;
}

export async function listDatasets(): Promise<Dataset[]> {
  await ensureDatabase();
  const rows = await sql`SELECT metadata FROM querymind_datasets ORDER BY uploaded_at DESC`;
  return rows.map((row) => row.metadata as Dataset);
}

export async function saveDataset(dataset: Dataset, tableNames: string[]) {
  await ensureDatabase();
  await sql`
    INSERT INTO querymind_datasets (id, connection_id, name, filename, size_bytes, metadata, table_names)
    VALUES (${dataset.id}, ${dataset.connection_id}, ${dataset.name}, ${dataset.filename}, ${dataset.size_bytes}, ${sql.json(JSON.parse(JSON.stringify(dataset)))}, ${tableNames})
  `;
}

export async function saveConversation(id: string, connectionId: string, intent: Intent | null) {
  await ensureDatabase();
  await sql`
    INSERT INTO querymind_conversations (id, connection_id, intent)
    VALUES (${id}, ${connectionId}, ${intent ? sql.json(JSON.parse(JSON.stringify(intent))) : null})
    ON CONFLICT (id) DO UPDATE SET intent = EXCLUDED.intent, updated_at = now()
  `;
}

export async function getConversation(id: string) {
  await ensureDatabase();
  const rows = await sql`SELECT * FROM querymind_conversations WHERE id = ${id}`;
  return rows[0] as { id: string; connection_id: string; intent: Intent | null } | undefined;
}

export async function saveQuery(id: string, conversationId: string, request: string, generatedSql: string, status: string) {
  await ensureDatabase();
  await sql`
    INSERT INTO querymind_queries (id, conversation_id, request, generated_sql, status)
    VALUES (${id}, ${conversationId}, ${request}, ${generatedSql}, ${status})
  `;
}

export function quotedIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function tableName(datasetId: string, table: string) {
  return `qm_${datasetId.replaceAll("-", "")}_${table.replaceAll(/[^a-zA-Z0-9_]/g, "_").toLowerCase()}`;
}
