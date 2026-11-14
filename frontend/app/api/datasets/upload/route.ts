import { NextResponse } from "next/server";
import { saveDataset } from "../../_lib/db";
import { ingest } from "../../_lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ detail: "A dataset file is required." }, { status: 400 });
    const dataset = await ingest(file.name, Buffer.from(await file.arrayBuffer()));
    await saveDataset(dataset, dataset.tables.map((table) => table.table));
    return NextResponse.json(dataset);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset processing failed." }, { status: 400 });
  }
}
