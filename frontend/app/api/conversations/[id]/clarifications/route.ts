import { NextResponse } from "next/server";
import { getConversation, saveConversation } from "../../../_lib/db";
import { processMessage } from "../../../_lib/query";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  const conversation = await getConversation(id);
  if (!conversation) return NextResponse.json({ detail: "Conversation not found." }, { status: 404 });
  const answers = await request.json() as Record<string, string>;
  const intent = { ...(conversation.intent || {}), ...answers, missing_information: (conversation.intent?.missing_information || []).filter((item) => !(item in answers)) };
  await saveConversation(id, conversation.connection_id, intent);
  const requestText = typeof intent.request === "string" ? intent.request : "";
  if (!requestText) return NextResponse.json({ status: "clarification_applied", conversation_id: id, intent });
  return processMessage(id, requestText, requestId);
}
