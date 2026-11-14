import { NextResponse } from "next/server";
import { databaseHealth } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = await databaseHealth();
    return NextResponse.json({ status: "ok", service: "querymind", database });
  } catch (error) {
    console.error("health_check_failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    return NextResponse.json({ status: "degraded", service: "querymind", database: { configured: false } }, { status: 503 });
  }
}
