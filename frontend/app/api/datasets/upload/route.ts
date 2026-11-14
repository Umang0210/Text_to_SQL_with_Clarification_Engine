import { NextResponse } from "next/server";
import { databaseErrorDetails } from "../../_lib/db";
import { ingest } from "../../_lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ detail: "A dataset file is required." }, { status: 400 });
    const dataset = await ingest(file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(dataset);
  } catch (error) {
    const details = databaseErrorDetails(error);
    console.error("dataset_upload_failed", details);
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset processing failed.", code: details.code }, { status: details.code ? 500 : 400 });
  }
}
