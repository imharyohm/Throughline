import { NextRequest, NextResponse } from "next/server";
import { recall, SearchType, SESSION_ID } from "@/lib/cognee";
import { extractAssumptions, detectContradiction } from "@/lib/detector";

export async function POST(req: NextRequest) {
  try {
    const {
      query,
      queryType = "GRAPH_COMPLETION_COT",
      withDetector = false,
      useSessionMemory = false,
      nodeName,
    } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const opts = {
      ...(useSessionMemory ? { sessionId: SESSION_ID } : {}),
      ...(nodeName ? { nodeName } : {}),
    };
    const result = await recall(
      query,
      queryType as SearchType,
      Object.keys(opts).length ? opts : undefined,
    );

    if (!withDetector) {
      return NextResponse.json({ query, queryType, result });
    }

    const assumptions = extractAssumptions();
    const queryLower = query.toLowerCase();
    // Specific match: the query names this exact assumption or its source
    // artifact. Only this narrows `targets` down — generic trigger words
    // (below) decide WHETHER to run the detector at all, not WHICH
    // assumptions, otherwise a word like "at risk" matches every assumption
    // identically and fans out into all of them every time.
    const specific = assumptions.filter(
      (a) =>
        queryLower.includes(a.id.toLowerCase()) ||
        queryLower.includes(a.sourceArtifact)
    );

    const targets = specific.length > 0 ? specific : assumptions.slice(0, 3);
    const findings = await Promise.all(
      targets.map((a) => detectContradiction(a).catch(() => null))
    );

    return NextResponse.json({
      query,
      queryType,
      result,
      contradictions: findings.filter(Boolean),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
