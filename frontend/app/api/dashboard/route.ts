import { NextResponse } from "next/server";
import { dashboardStats, databaseErrorDetails } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await dashboardStats());
  } catch (error) {
    const details = databaseErrorDetails(error);
    console.error("dashboard_metrics_failed", details);
    return NextResponse.json({ detail: `Dashboard metrics query failed${details.code ? ` (${details.code})` : ""}: ${details.detail}` }, { status: 503 });
  }
}
