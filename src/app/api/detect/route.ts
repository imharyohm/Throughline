import { NextRequest, NextResponse } from "next/server";
import {
  runDetector,
  detectContradiction,
  extractAssumptions,
} from "@/lib/detector";

export async function POST(req: NextRequest) {
  try {
    const { assumptionId, persist = true } = await req.json().catch(() => ({}));

    if (assumptionId) {
      const assumptions = extractAssumptions();
      const target = assumptions.find(
        (a) => a.id.toUpperCase() === assumptionId.toUpperCase()
      );
      if (!target) {
        return NextResponse.json(
          { error: `Assumption ${assumptionId} not found` },
          { status: 404 }
        );
      }
      const finding = await detectContradiction(target);
      return NextResponse.json({ finding });
    }

    const report = await runDetector({ persist });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const assumptions = extractAssumptions();
  return NextResponse.json({ assumptions });
}
