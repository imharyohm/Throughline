import { NextRequest, NextResponse } from "next/server";
import { groqComplete } from "@/lib/llm/groq";

// Rewrites a technical COT/graph answer into one plain-English paragraph.
// Directly targets the Day-5 plan's own goal: "a non-technical viewer gets
// the wow in 30 seconds." Cognee's answer is accurate but written for an
// engineer (assumption ids, ADR numbers, TPS figures); this is a second,
// independent Groq call over text we already have — not a Cognee call, so it
// can't make Cognee's flakiness worse, but it can itself fail like any LLM
// call, so the caller should treat a non-200 as "skip the simple version."
export async function POST(req: NextRequest) {
  try {
    const { answer } = await req.json();
    if (!answer || typeof answer !== "string") {
      return NextResponse.json({ error: "answer (string) is required" }, { status: 400 });
    }

    const summary = await groqComplete(
      [
        {
          role: "system",
          content:
            "Rewrite the following technical answer as ONE short plain-English paragraph " +
            "(2-4 sentences) for a non-technical stakeholder. Keep the key facts (what was " +
            "decided, what broke, why it matters) but drop jargon, ids, and citations. " +
            "No markdown, no bullet points — just plain prose.",
        },
        { role: "user", content: answer },
      ],
      0.3,
    );

    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
