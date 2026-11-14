import { NextResponse } from "next/server";
import { saveConversation } from "../_lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const connectionId = new URL(request.url).searchParams.get("connection_id");
  if (!connectionId) return NextResponse.json({ detail: "connection_id is required." }, { status: 400 });
  const id = crypto.randomUUID();
  await saveConversation(id, connectionId, null);
  return NextResponse.json({ id });
}
