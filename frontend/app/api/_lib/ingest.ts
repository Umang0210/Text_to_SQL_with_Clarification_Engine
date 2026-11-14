import * as XLSX from "xlsx";
import initSqlJs from "sql.js";
import path from "node:path";
import { quotedIdentifier, sql, tableName } from "./db";
import type { Dataset, SchemaTable } from "./types";

const allowed = new Set([".csv", ".xlsx", ".xls", ".json", ".db", ".sqlite", ".sqlite3"]);
const maxBytes = 4 * 1024 * 1024;

function safeColumn(value: unknown, index: number) {
  const name = String(value ?? `column_${index}`).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
  return name || `column_${index}`;
}

function rowsFromBuffer(filename: string, buffer: Buffer) {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (extension === ".json") {
    const parsed = JSON.parse(buffer.toString("utf8"));
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray);
    if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === "object")) throw new Error("JSON must contain an array of objects.");
    return [{ name: filename.replace(/\.[^.]+$/, ""), rows }];
  }
  if ([".db", ".sqlite", ".sqlite3"].includes(extension)) return sqliteRows(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: null });
    const headers = (raw.shift() || []).map(safeColumn);
    return { name, rows: raw.filter((row) => row.some((value) => value !== null)).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))) };
  });
}

async function sqliteRows(buffer: Buffer) {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file) });
  const database = new SQL.Database(buffer);
  try {
    return database.exec("SELECT name FROM sqlite_master WHERE type='table'").flatMap((result) =>
      (result.values as unknown[][]).map(([name]) => {
        const table = String(name);
        const data = database.exec(`SELECT * FROM ${quotedIdentifier(table)}`)[0];
        return { name: table, rows: data.values.map((row) => Object.fromEntries(data.columns.map((column, index) => [column, row[index]]))) };
      }),
    );
  } finally {
    database.close();
  }
}

export async function ingest(filename: string, buffer: Buffer): Promise<Dataset> {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!allowed.has(extension)) throw new Error("Supported formats are CSV, Excel, JSON and SQLite.");
  if (buffer.byteLength > maxBytes) throw new Error("Files must be 50 MB or smaller.");
  const datasetId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const sources = await rowsFromBuffer(filename, buffer);
  const tables: SchemaTable[] = [];
  const preview: Record<string, unknown>[] = [];
  const keys: Record<string, string[]> = {};
  for (const source of sources) {
    if (!source.rows.length) continue;
    const columns = [...new Set(Object.keys(source.rows[0]).map((column, index) => safeColumn(column, index)))];
    const physical = tableName(datasetId, source.name);
    await sql`CREATE TABLE ${sql(quotedIdentifier(physical))} (${sql(columns.map((column) => `${quotedIdentifier(column)} text`).join(", "))})`;
    for (const row of source.rows) {
      const values = columns.map((column) => row[column]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await sql.unsafe(
        `INSERT INTO ${quotedIdentifier(physical)} (${columns.map(quotedIdentifier).join(", ")}) VALUES (${placeholders})`,
        values,
      );
    }
    const count = source.rows.length;
    const candidates = columns.filter((column) => new Set(source.rows.map((row) => row[column])).size === count);
    tables.push({ table: physical, columns: columns.map((name) => ({ name, type: "text" })), row_count: count });
    keys[physical] = candidates;
    preview.push(...source.rows.slice(0, 100));
  }
  const dataset = { id: datasetId, connection_id: connectionId, name: filename.replace(/\.[^.]+$/, ""), filename, size_bytes: buffer.byteLength, uploaded_at: new Date().toISOString(), tables, preview: preview.slice(0, 100), duplicate_rows: 0, potential_primary_keys: keys };
  await sql`CREATE TABLE IF NOT EXISTS ${sql(quotedIdentifier(`qm_meta_${datasetId.replaceAll("-", "")}`))} (id text)`;
  return dataset;
}
