import { NextResponse } from "next/server";
import { renameDataset } from "../../../_lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { name?: string };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ detail: "Dataset name is required." }, { status: 400 });
    const dataset = await renameDataset(id, name);
    return dataset ? NextResponse.json(dataset) : NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  } catch (error) {
    console.error("dataset_rename_failed", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset rename failed." }, { status: 422 });
  }
}
