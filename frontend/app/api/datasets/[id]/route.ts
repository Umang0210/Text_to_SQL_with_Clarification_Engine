import { NextResponse } from "next/server";
import { deleteDataset } from "../../_lib/db";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deleted = await deleteDataset(id);
    return deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
  } catch (error) {
    console.error("dataset_delete_failed", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Dataset deletion failed." }, { status: 422 });
  }
}
