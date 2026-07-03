import { NextResponse } from "next/server";
import { getCognifyStatus, activeTarget } from "@/lib/cognee";

export async function GET() {
  try {
    const result = await getCognifyStatus();
    return NextResponse.json({ status: "ok", target: activeTarget, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, target: activeTarget }, { status: 500 });
  }
}
