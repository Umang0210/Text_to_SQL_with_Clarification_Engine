import * as XLSX from "xlsx";
import initSqlJs from "sql.js";
import path from "node:path";
import { databaseErrorDetails, ensureDatabase, quotedIdentifier, sql, tableName } from "./db";
import type { Dataset, SchemaTable } from "./types";

const allowed = new Set([".csv", ".xlsx", ".xls", ".json", ".db", ".sqlite", ".sqlite3"]);
const maxBytes = 4 * 1024 * 1024;

function safeColumn(value: unknown, index: number) {
  const name = String(value ?? `column_${index}`).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
  return name || `column_${index}`;
}

function uniqueColumns(values: unknown[]) {
  const used = new Map<string, number>();
  return values.map((value, index) => {
    const base = safeColumn(value, index);
    const occurrence = used.get(base) ?? 0;
    used.set(base, occurrence + 1);
    return occurrence ? `${base}_${occurrence + 1}` : base;
  });
}

function normalizeRows(rows: Record<string, unknown>[], headers?: unknown[]) {
  const sourceHeaders = headers?.map(String) ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns = uniqueColumns(sourceHeaders);
  return {
    columns,
    displayNames: sourceHeaders.map((header) => header || "Unnamed column"),
    rows: rows.map((row) => {
      return Object.fromEntries(columns.map((column, index) => [column, row[sourceHeaders[index]] ?? null]));
    }),
  };
}

function inferType(values: unknown[]) {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (!present.length) return "text";
  if (present.every((value) => typeof value === "boolean")) return "boolean";
  if (present.every((value) => typeof value === "number" && Number.isInteger(value))) return "bigint";
  if (present.every((value) => typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)))) return "numeric";
  if (present.every((value) => value instanceof Date || (typeof value === "string" && !Number.isNaN(Date.parse(value))))) return "timestamptz";
  return "text";
}

function parameterValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
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
    const headers = raw.shift() || [];
    const sourceHeaders = headers.map((header, index) => {
      const value = String(header ?? "").trim();
      return value || `column_${index}`;
    });
    return {
      name,
      rows: raw
        .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ""))
        .map((row) => Object.fromEntries(sourceHeaders.map((header, index) => [header, row[index] ?? null]))),
    };
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
  await ensureDatabase();
  return sql.begin(async (transaction) => {
    const tables: SchemaTable[] = [];
    const preview: Record<string, unknown>[] = [];
    const keys: Record<string, string[]> = {};
    const usedPhysicalNames = new Set<string>();
    for (const source of sources) {
      if (!source.rows.length) continue;
      const normalized = normalizeRows(source.rows);
      const columns = normalized.columns;
      if (!columns.length) continue;
      const basePhysical = tableName(datasetId, source.name);
      let physical = basePhysical;
      let suffix = 2;
      while (usedPhysicalNames.has(physical)) physical = `${basePhysical}_${suffix++}`;
      usedPhysicalNames.add(physical);
      const definitions = columns.map((column) => `${quotedIdentifier(column)} ${inferType(normalized.rows.map((row) => row[column]))}`).join(", ");
      try {
        await transaction.unsafe(`CREATE TABLE ${quotedIdentifier(physical)} (${definitions})`);
        const batchSize = 250;
        for (let offset = 0; offset < normalized.rows.length; offset += batchSize) {
          const batch = normalized.rows.slice(offset, offset + batchSize);
          const values = batch.flatMap((row) => columns.map((column) => parameterValue(row[column])));
          const placeholders = batch.map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`).join(", ");
          const insertStatement = `INSERT INTO ${quotedIdentifier(physical)} (${columns.map(quotedIdentifier).join(", ")}) VALUES ${placeholders}`;
          await transaction.unsafe(insertStatement, values);
        }
      } catch (error) {
        const details = databaseErrorDetails(error);
        console.error("dataset_import_table_failed", { datasetId, sourceName: source.name, physicalTable: physical, ...details });
        throw new Error(`Could not import sheet "${source.name}" into PostgreSQL${details.code ? ` (${details.code})` : ""}: ${details.detail}`);
      }
      const count = normalized.rows.length;
      const candidates = columns.filter((column) => new Set(normalized.rows.map((row) => row[column])).size === count);
      tables.push({ table: physical, source_name: source.name, columns: columns.map((name, index) => ({ name, display_name: normalized.displayNames[index], type: inferType(normalized.rows.map((row) => row[name])) })), row_count: count });
      keys[physical] = candidates;
      preview.push(...normalized.rows.slice(0, 100));
    }
    if (!tables.length) throw new Error("The dataset contains no rows with usable columns.");
    const dataset = { id: datasetId, connection_id: connectionId, name: filename.replace(/\.[^.]+$/, ""), filename, size_bytes: buffer.byteLength, uploaded_at: new Date().toISOString(), tables, preview: preview.slice(0, 100), duplicate_rows: 0, potential_primary_keys: keys, total_rows: tables.reduce((total, table) => total + table.row_count, 0) };
    await transaction`
      INSERT INTO querymind_datasets (id, connection_id, name, filename, size_bytes, metadata, table_names)
      VALUES (${dataset.id}, ${dataset.connection_id}, ${dataset.name}, ${dataset.filename}, ${dataset.size_bytes}, ${sql.json(JSON.parse(JSON.stringify(dataset)))}, ${tables.map((table) => table.table)})
    `;
    return dataset;
  });
}
