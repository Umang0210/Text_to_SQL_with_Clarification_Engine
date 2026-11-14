import { NextResponse } from "next/server";
import { dashboardStats } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await dashboardStats());
  } catch (error) {
    console.error("dashboard_metrics_failed", {
      message: error instanceof Error ? error.message : "Unknown database error",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    });
    return NextResponse.json({ detail: "Dashboard metrics are unavailable. Check the PostgreSQL connection and database permissions." }, { status: 503 });
  }
}
