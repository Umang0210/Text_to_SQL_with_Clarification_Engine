import { NextResponse } from "next/server";
import { getDataset } from "../../../_lib/db";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataset = await getDataset(id);
  return dataset ? NextResponse.json(dataset) : NextResponse.json({ detail: "Dataset not found." }, { status: 404 });
}
