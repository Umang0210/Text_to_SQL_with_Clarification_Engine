import { GoogleGenAI } from "@google/genai";
import type { Intent, SchemaTable } from "./types";

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const aiTimeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 7000);
const aiRetries = Number(process.env.GEMINI_RETRIES ?? 1);
const client = key ? new GoogleGenAI({ apiKey: key, httpOptions: { timeout: aiTimeoutMs } }) : null;

export class AIUnavailableError extends Error {}

async function jsonPrompt(instruction: string, context: unknown, timeoutMs = aiTimeoutMs, requestId = "unknown") {
  if (!client) throw new AIUnavailableError("GEMINI_API_KEY is not configured on the server.");
  for (let attempt = 0; attempt <= aiRetries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await Promise.race([
        client.models.generateContent({
          model,
          contents: `${instruction}\n\nContext JSON:\n${JSON.stringify(context)}`,
          config: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Gemini request timed out after ${timeoutMs}ms.`)), timeoutMs)),
      ]);
      const text = response.text;
      if (!text) throw new Error("Gemini returned an empty response.");
      return JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Gemini error";
      console.error("gemini_request_failed", {
        requestId,
        attempt: attempt + 1,
        durationMs: Date.now() - started,
        message,
      });
      if (/timeout|timed out/i.test(message)) throw new AIUnavailableError(message);
      if (attempt === aiRetries) throw new AIUnavailableError(error instanceof Error ? error.message : "Gemini request failed.");
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new AIUnavailableError("Gemini request failed.");
}

export async function understandIntent(request: string, schema: SchemaTable[], previous: Intent | null, requestId?: string) {
  return jsonPrompt(
    "Extract intent as JSON with operation, metric, dimensions, filters, time_range, ranking, and missing_information. Use only identifiers from schema. Ask for missing information only if it changes the SQL result.",
    { request, schema, previous },
    aiTimeoutMs,
    requestId,
  ) as Promise<Intent>;
}

export async function clarify(intent: Intent, schema: SchemaTable[], requestId?: string) {
  const result = await jsonPrompt(
    "Create targeted clarification questions as JSON {questions:[{id,question,kind,options}]}. Ask only about fields in missing_information and use the schema context. Never ask a generic question.",
    { intent, schema },
    aiTimeoutMs,
    requestId,
  );
  return Array.isArray(result.questions) ? result.questions : [];
}

export async function generateSql(intent: Intent, schema: SchemaTable[], requestId?: string) {
  const result = await jsonPrompt(
    "Generate JSON {sql}. SQL must be one read-only PostgreSQL SELECT statement using only the supplied tables and columns. Never invent identifiers.",
    { intent, schema },
    aiTimeoutMs,
    requestId,
  );
  if (typeof result.sql !== "string" || !result.sql.trim()) throw new Error("Gemini returned no SQL.");
  return result.sql;
}

export async function explain(sql: string, rows: Record<string, unknown>[], dataset: string, requestId?: string) {
  const result = await jsonPrompt(
    "Return JSON {explanation} with a concise explanation based only on the supplied SQL and rows. Never invent findings.",
    { sql, rows, dataset },
    Math.min(aiTimeoutMs, 5000),
    requestId,
  );
  return typeof result.explanation === "string" ? result.explanation : `Returned ${rows.length} row(s) from ${dataset}.`;
}
