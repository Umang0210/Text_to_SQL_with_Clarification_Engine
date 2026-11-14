import { NextResponse } from "next/server";
import { dashboardStats } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await dashboardStats());
  } catch {
    return NextResponse.json({ detail: "Dashboard metrics are unavailable. Configure DATABASE_URL." }, { status: 503 });
  }
}
