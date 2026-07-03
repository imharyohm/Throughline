import { NextRequest, NextResponse } from "next/server";
import { improve } from "@/lib/cognee";

export async function POST(req: NextRequest) {
  try {
    const { question, answer, score } = await req.json().catch(() => ({}));
    const result = await improve(
      question && answer ? { question, answer, score } : undefined,
    );
    return NextResponse.json({ status: "ok", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
