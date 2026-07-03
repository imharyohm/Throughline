import { corpus } from "../../../data/corpus";
import { groqComplete } from "./groq";

// Degraded-mode fallback — used ONLY when Cognee Cloud's /recall has already
// exhausted its retries and thrown (see cloud.ts's req()). This deliberately
// uses the STATIC corpus, not listArtifacts(), because listArtifacts() itself
// calls Cognee — reaching for it here would mean the fallback for "Cognee is
// down" depends on Cognee being up. The whole point is a path that survives
// Cognee Cloud being unavailable during a live demo (the exact risk the
// plan's Day-6 doc already names: "Live demo fails → play the recorded
// video"). This turns that into "still works, just says so" instead.
//
// No graph traversal, no multi-hop reasoning, no contradiction detection —
// just the raw corpus text stuffed into one prompt. Weaker than the real
// answer, but a live answer instead of nothing.
const CORPUS_TEXT = corpus
  .map((a) => `[${a.type.toUpperCase()}] ${a.title}\nDate: ${a.date}\n\n${a.content}`)
  .join("\n\n---\n\n");

export interface DegradedAnswer {
  answer: string;
  degraded: true;
}

export async function degradedRecall(query: string): Promise<DegradedAnswer> {
  const answer = await groqComplete([
    {
      role: "system",
      content:
        "You are answering a question about a software team's engineering decisions, using only the documents provided below. " +
        "Cite specific documents by name when relevant. If the documents don't contain the answer, say so plainly. " +
        "You have no knowledge graph, no multi-hop reasoning trace, and no contradiction-detection pass available right now — just these raw documents.",
    },
    {
      role: "user",
      content: `${CORPUS_TEXT}\n\n---\n\nQUESTION: ${query}`,
    },
  ]);

  return { answer, degraded: true };
}
