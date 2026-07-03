import { NextRequest, NextResponse } from "next/server";
import { remember, cognify } from "@/lib/cognee";

export async function POST(req: NextRequest) {
  try {
    const { title, date, type, content, nodeSet = "outcomes" } = await req.json();

    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required" }, { status: 400 });
    }

    const typeLabel = (type || "document").toUpperCase();
    const dateLine = date ? `Date: ${date}\n\n` : "\n";
    const text = `[${typeLabel}] ${title}\n${dateLine}${content}`;

    const result = await remember(text, [nodeSet]);

    // Fire-and-forget, matching /api/ingest — cognify has stalled for 20+
    // hours with no error surfaced on this tenant before; awaiting it here
    // would hang the whole Vercel function.
    cognify().catch(() => {});

    return NextResponse.json({ status: "cognify_started", title, nodeSet, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
