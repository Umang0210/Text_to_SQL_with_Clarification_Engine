import { NextResponse } from "next/server";
import { listQueries } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listQueries());
  } catch {
    return NextResponse.json({ detail: "Query history is unavailable. Configure DATABASE_URL." }, { status: 503 });
  }
}
