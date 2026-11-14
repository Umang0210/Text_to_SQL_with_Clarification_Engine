import { NextResponse } from "next/server";
import { datasetPreview } from "../../../_lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const params = new URL(_request.url).searchParams;
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") ?? 25)));
    const result = await datasetPreview(id, params.get("table") ?? undefined, page, pageSize, params.get("search") ?? "", params.get("sort") ?? undefined, params.get("direction") === "desc" ? "desc" : "asc");
    return result ? NextResponse.json(result) : NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  } catch (error) {
    console.error("dataset_preview_failed", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset preview failed." }, { status: 422 });
  }
}
