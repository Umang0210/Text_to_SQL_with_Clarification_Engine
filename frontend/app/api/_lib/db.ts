import postgres from "postgres";
import type { Dataset, Intent, SchemaTable } from "./types";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") {
  console.warn("DATABASE_URL is not configured; QueryMind API routes cannot persist data.");
}

export const sql = postgres(connectionString || "postgres://localhost/querymind", {
  max: Number(process.env.DB_POOL_MAX ?? 5),
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connection: { statement_timeout: 10_000 },
});

export function databaseErrorDetails(error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: string; detail?: string; message?: string } : {};
  return {
    code: value.code,
    detail: String(value.detail ?? value.message ?? "Unknown PostgreSQL error").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted connection]"),
  };
}

let databaseReady: Promise<void> | null = null;

export async function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = sql.begin(async (transaction) => {
      await transaction`
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
      await transaction`
        CREATE TABLE IF NOT EXISTS querymind_conversations (
          id text PRIMARY KEY,
          connection_id text NOT NULL,
          intent jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS querymind_queries (
          id text PRIMARY KEY,
          conversation_id text NOT NULL,
          request text NOT NULL,
          generated_sql text NOT NULL,
          status text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await transaction`ALTER TABLE querymind_datasets ADD COLUMN IF NOT EXISTS metadata jsonb`;
      await transaction`ALTER TABLE querymind_datasets ADD COLUMN IF NOT EXISTS table_names text[]`;
      await transaction`ALTER TABLE querymind_conversations ADD COLUMN IF NOT EXISTS intent jsonb`;
      await transaction`ALTER TABLE querymind_queries ADD COLUMN IF NOT EXISTS status text`;
    }).then(() => undefined).catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
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

export async function listQueries() {
  await ensureDatabase();
  return sql`SELECT id, conversation_id, request, generated_sql, status, created_at FROM querymind_queries ORDER BY created_at DESC LIMIT 100`;
}

export async function dashboardStats() {
  await ensureDatabase();
  const [metrics] = await sql`
    WITH dataset_stats AS (
      SELECT
        COUNT(*)::int AS datasets,
        COALESCE(SUM(
          CASE WHEN jsonb_typeof(metadata->'tables') = 'array'
            THEN jsonb_array_length(metadata->'tables')
            ELSE 0
          END
        ), 0)::int AS tables,
        COALESCE(SUM(
          CASE
            WHEN metadata->>'total_rows' ~ '^[0-9]+$' THEN (metadata->>'total_rows')::bigint
            ELSE (
              SELECT COALESCE(SUM((table_item->>'row_count')::bigint), 0)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(metadata->'tables') = 'array'
                  THEN metadata->'tables'
                  ELSE '[]'::jsonb
                END
              ) AS table_item
            )
          END
        ), 0)::bigint AS records,
        COALESCE(ROUND(AVG(size_bytes)), 0)::int AS average_dataset_size
      FROM querymind_datasets
    ),
    query_stats AS (
      SELECT
        COUNT(*)::int AS queries,
        COUNT(*) FILTER (WHERE status = 'success')::int AS successful_queries,
        COUNT(*) FILTER (WHERE status <> 'success')::int AS failed_queries
      FROM querymind_queries
    ),
    activity AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', query_date, 'count', query_count) ORDER BY query_date), '[]'::jsonb) AS query_activity
      FROM (
        SELECT created_at::date AS query_date, COUNT(*)::int AS query_count
        FROM querymind_queries
        WHERE created_at >= CURRENT_DATE - INTERVAL '13 days'
        GROUP BY created_at::date
      ) daily
    )
    SELECT dataset_stats.datasets, dataset_stats.tables, dataset_stats.records,
      dataset_stats.average_dataset_size, query_stats.queries,
      query_stats.successful_queries, query_stats.failed_queries, activity.query_activity
    FROM dataset_stats CROSS JOIN query_stats CROSS JOIN activity
  `;
  return {
    datasets: metrics?.datasets ?? 0,
    tables: metrics?.tables ?? 0,
    records: Number(metrics?.records ?? 0),
    totalRecords: Number(metrics?.records ?? 0),
    averageDatasetSize: metrics?.average_dataset_size ?? 0,
    queries: metrics?.queries ?? 0,
    successfulQueries: metrics?.successful_queries ?? 0,
    failedQueries: metrics?.failed_queries ?? 0,
    queryActivity: metrics?.query_activity ?? [],
  };
}

export async function databaseHealth() {
  await ensureDatabase();
  await sql`SELECT 1`;
  return { configured: Boolean(connectionString), poolSize: Number(process.env.DB_POOL_MAX ?? 5) };
}

export function quotedIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function tableName(datasetId: string, table: string) {
  return `qm_${datasetId.replaceAll("-", "")}_${table.replaceAll(/[^a-zA-Z0-9_]/g, "_").toLowerCase()}`;
}
