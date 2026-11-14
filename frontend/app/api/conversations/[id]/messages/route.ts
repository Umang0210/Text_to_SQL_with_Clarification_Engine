import { NextResponse } from "next/server";
import { processMessage } from "../../../_lib/query";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { content?: string };
    if (!body.content?.trim()) return NextResponse.json({ detail: "Query text is required." }, { status: 400 });
    return await processMessage(id, body.content);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Query execution failed." }, { status: 422 });
  }
}
