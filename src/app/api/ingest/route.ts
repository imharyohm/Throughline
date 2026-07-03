import { NextRequest, NextResponse } from "next/server";
import { remember, cognify } from "@/lib/cognee";
import { corpus } from "../../../../data/corpus";

export async function POST(req: NextRequest) {
  try {
    const { artifactId } = await req.json().catch(() => ({}));

    const artifacts = artifactId
      ? corpus.filter((a) => a.id === artifactId)
      : corpus;

    if (artifacts.length === 0) {
      return NextResponse.json({ error: "No artifacts found" }, { status: 404 });
    }

    const remembered = [];
    for (const artifact of artifacts) {
      const text = `[${artifact.type.toUpperCase()}] ${artifact.title}\nDate: ${artifact.date}\n\n${artifact.content}`;
      const result = await remember(text, artifact.nodeSet);
      remembered.push({ id: artifact.id, title: artifact.title, result });
      // Rapid back-to-back /remember calls against the same freshly-created
      // dataset can 409 with a backend ProgrammingError (observed live) —
      // a short gap between calls avoids the race.
      await new Promise((r) => setTimeout(r, 1200));
    }

    // trigger graph build in background
    cognify().catch(() => {});

    return NextResponse.json({
      ingested: remembered.length,
      artifacts: remembered,
      status: "cognify_started",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ artifacts: corpus.map((a) => ({ id: a.id, title: a.title, type: a.type, date: a.date })) });
}
