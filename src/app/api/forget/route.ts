import { NextRequest, NextResponse } from "next/server";
import { forget } from "@/lib/cognee";

export async function POST(req: NextRequest) {
  try {
    const { dataId, memoryOnly = true } = await req.json().catch(() => ({}));
    const result = await forget(dataId, memoryOnly);
    return NextResponse.json({ status: "ok", memoryOnly, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
