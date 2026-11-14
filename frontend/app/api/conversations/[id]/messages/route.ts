import { NextResponse } from "next/server";
import { processMessage } from "../../../_lib/query";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    const body = await request.json() as { content?: string };
    if (!body.content?.trim()) return NextResponse.json({ detail: "Query text is required." }, { status: 400 });
    return await processMessage(id, body.content, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query execution failed.";
    console.error("query_request_failed", { requestId, message });
    const status = /timeout|timed out/i.test(message) ? 504 : /gemini/i.test(message) ? 503 : 422;
    return NextResponse.json({ detail: message, request_id: requestId }, { status });
  }
}
