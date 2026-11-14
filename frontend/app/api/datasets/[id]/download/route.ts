import { datasetDownload } from "../../../_lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const table = new URL(request.url).searchParams.get("table") ?? undefined;
    const result = await datasetDownload(id, table);
    if (!result) return Response.json({ detail: "Dataset not found." }, { status: 404 });
    return new Response(result.content, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename.replace(/["\\\r\n]/g, "")}"`,
      },
    });
  } catch (error) {
    console.error("dataset_download_failed", error);
    return Response.json({ detail: error instanceof Error ? error.message : "Dataset download failed." }, { status: 422 });
  }
}
