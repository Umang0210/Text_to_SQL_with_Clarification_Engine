import { NextResponse } from "next/server";
import { datasetInsights } from "../../../_lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const table = new URL(request.url).searchParams.get("table") ?? undefined;
    const result = await datasetInsights(id, table);
    return result ? NextResponse.json(result) : NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  } catch (error) {
    console.error("dataset_insights_failed", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset insights failed." }, { status: 422 });
  }
}
