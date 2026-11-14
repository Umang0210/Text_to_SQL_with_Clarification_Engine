import { NextResponse } from "next/server";
import { listDatasets } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listDatasets());
  } catch {
    return NextResponse.json({ detail: "Persistent database is unavailable. Configure DATABASE_URL." }, { status: 503 });
  }
}
