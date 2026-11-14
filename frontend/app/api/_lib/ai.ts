import { GoogleGenAI } from "@google/genai";
import type { Intent, SchemaTable } from "./types";

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const client = key ? new GoogleGenAI({ apiKey: key }) : null;

export class AIUnavailableError extends Error {}

async function jsonPrompt(instruction: string, context: unknown) {
  if (!client) throw new AIUnavailableError("GEMINI_API_KEY is not configured on the server.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: `${instruction}\n\nContext JSON:\n${JSON.stringify(context)}`,
        config: { responseMimeType: "application/json", temperature: 0.1 },
      });
      const text = response.text;
      if (!text) throw new Error("Gemini returned an empty response.");
      return JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
  throw new AIUnavailableError("Gemini request failed.");
}

export async function understandIntent(request: string, schema: SchemaTable[], previous: Intent | null) {
  return jsonPrompt(
    "Extract intent as JSON with operation, metric, dimensions, filters, time_range, ranking, and missing_information. Use only identifiers from schema. Ask for missing information only if it changes the SQL result.",
    { request, schema, previous },
  ) as Promise<Intent>;
}

export async function clarify(intent: Intent, schema: SchemaTable[]) {
  const result = await jsonPrompt(
    "Create targeted clarification questions as JSON {questions:[{id,question,kind,options}]}. Ask only about fields in missing_information and use the schema context. Never ask a generic question.",
    { intent, schema },
  );
  return Array.isArray(result.questions) ? result.questions : [];
}

export async function generateSql(intent: Intent, schema: SchemaTable[]) {
  const result = await jsonPrompt(
    "Generate JSON {sql}. SQL must be one read-only PostgreSQL SELECT statement using only the supplied tables and columns. Never invent identifiers.",
    { intent, schema },
  );
  if (typeof result.sql !== "string" || !result.sql.trim()) throw new Error("Gemini returned no SQL.");
  return result.sql;
}

export async function explain(sql: string, rows: Record<string, unknown>[], dataset: string) {
  const result = await jsonPrompt(
    "Return JSON {explanation} with a concise explanation based only on the supplied SQL and rows. Never invent findings.",
    { sql, rows, dataset },
  );
  return typeof result.explanation === "string" ? result.explanation : `Returned ${rows.length} row(s) from ${dataset}.`;
}
