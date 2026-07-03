import { NextRequest, NextResponse } from "next/server";
import { recall, SearchType, SESSION_ID } from "@/lib/cognee";
import { extractAssumptions, detectContradiction } from "@/lib/detector";
import { degradedRecall } from "@/lib/llm/fallback";
import type { RecallResult } from "@/lib/cognee";

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

    let result: RecallResult;
    let degraded = false;
    try {
      result = await recall(
        query,
        queryType as SearchType,
        Object.keys(opts).length ? opts : undefined,
      );
    } catch (recallErr) {
      // Cognee Cloud has already exhausted its own retries (cloud.ts's
      // req(), 3 attempts with backoff) and thrown — this is the "Cognee is
      // genuinely down" case the plan's Day-6 doc names as its worst-case
      // demo risk. Answer directly from the static corpus via Groq instead
      // of surfacing a raw error: no graph, no multi-hop trace, no
      // contradiction detection, but a live answer instead of a dead screen.
      const fallback = await degradedRecall(query).catch(() => null);
      if (!fallback) throw recallErr; // Groq fallback ALSO failed — surface the original error
      result = { answer: fallback.answer, target: "cloud", source: "degraded-groq-fallback" };
      degraded = true;
    }

    if (!withDetector || degraded) {
      // No graph in degraded mode — nothing for the detector to trace.
      return NextResponse.json({ query, queryType, result, degraded });
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
