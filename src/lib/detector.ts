import { cognify, listArtifacts, recall, remember } from "./cognee";
import type { RawArtifact } from "./cognee";
import { corpus } from "../../data/corpus";
import { groqCompleteJSON } from "./llm/groq";

export interface Assumption {
  id: string;
  text: string;
  sourceArtifact: string;
  sourceTitle: string;
  date: string;
  /** How this assumption was found — surfaced in the UI so an LLM-inferred
   *  assumption (from freeform text with no hand-authored "**A1**:" tag) is
   *  visibly not the same thing as a demo-corpus one. Defaults to "regex" for
   *  every existing call site (the static corpus + tagged live uploads). */
  extractedBy?: "regex" | "llm";
}

export interface ContradictionFinding {
  assumption: Assumption;
  verdict: "contradicted" | "valid" | "uncertain";
  confidence: number;
  conflictingEvidence: string | null;
  conflictingSource: string | null;
  conflictingDate: string | null;
  reason: string;
  rawCotAnswer: string;
  /** Whether the verdict was structured by the LLM or fell back to keyword
   *  regex (see parseVerdict) because the LLM call failed/was unavailable. */
  verdictSource?: "llm" | "regex";
}

export interface DetectorReport {
  runAt: string;
  findings: ContradictionFinding[];
  summary: {
    total: number;
    contradicted: number;
    valid: number;
    uncertain: number;
  };
  /** Whether contradicted findings were written back into Cognee this run. */
  persisted: boolean;
  persistedCount: number;
}

export function extractAssumptions(): Assumption[] {
  const assumptions: Assumption[] = [];

  for (const artifact of corpus) {
    const lines = artifact.content.split("\n");
    for (const line of lines) {
      const match = line.match(/\*\*([Aa]\d+)\*\*:\s*(.+)/);
      if (match) {
        assumptions.push({
          id: match[1].toUpperCase(),
          text: match[2].trim().replace(/\.$/, ""),
          sourceArtifact: artifact.id,
          sourceTitle: artifact.title,
          date: artifact.date,
        });
      }
    }
  }

  return assumptions;
}

function assumptionsFromContent(content: string): { id: string; text: string }[] {
  const found: { id: string; text: string }[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/\*\*([Aa]\d+)\*\*:\s*(.+)/);
    if (match) {
      found.push({ id: match[1].toUpperCase(), text: match[2].trim().replace(/\.$/, "") });
    }
  }
  return found;
}

interface LlmAssumption {
  text: string;
}

// Per-process cache keyed by artifact id — extractLiveAssumptions() runs on
// every /api/detect GET and every LiveUploadPanel open, so without this an
// unchanged artifact would re-trigger a Groq call every single time.
const llmAssumptionCache = new Map<string, LlmAssumption[]>();

/**
 * Real-document fallback for extractAssumptions()'s regex. The regex only
 * ever finds an assumption because the demo corpus was hand-authored with a
 * literal "**A1**: ..." tag — no real team's ADRs, postmortems, or commit
 * messages look like that. This asks the LLM to read arbitrary prose and pull
 * out implicit, falsifiable engineering assumptions the way a human reviewer
 * would, which is what makes the product work on real documents instead of
 * only the synthetic corpus it ships with.
 */
async function extractAssumptionsWithLLM(content: string): Promise<LlmAssumption[]> {
  const prompt = [
    "You are reviewing an engineering document (ADR, RFC, postmortem, meeting notes, or commit message).",
    "Extract every IMPLICIT or EXPLICIT assumption about the future that the document's decisions or conclusions depend on —",
    "the kind of claim that could later turn out false (e.g. expected scale, load, usage pattern, timeline, or 'no need for X yet').",
    "Do not invent assumptions that aren't actually implied by the text. If there are none, return an empty array.",
    "Only extract assumptions central to the document's own decision or conclusion — not incidental details,",
    "not meta-commentary about confidence scores or detection tooling.",
    'Respond with strict JSON: {"assumptions": [{"text": "..."}]}. Max 2 items, each one sentence, no markdown.',
    "",
    "DOCUMENT:",
    content.slice(0, 6000), // keep the prompt bounded regardless of upload size
  ].join("\n");

  try {
    const parsed = await groqCompleteJSON<{ assumptions?: LlmAssumption[] }>([
      { role: "user", content: prompt },
    ]);
    return (parsed.assumptions ?? []).filter((a) => a.text?.trim());
  } catch {
    return []; // Groq unreachable/misconfigured — degrade to "no assumptions found", not a crash
  }
}

/**
 * Same as extractAssumptions(), but sourced live from Cognee's own dataset
 * instead of the static corpus file — so an assumption pattern in a document
 * added after startup (e.g. via the live-upload feature) is picked up too,
 * not just the 7 baked into data/corpus/index.ts. Static entries win on id
 * collision (readable attribution — "adr-001" beats a raw Cognee data uuid);
 * only genuinely new ids get their attribution from the live artifact.
 *
 * For any live artifact where the regex finds nothing — i.e. anything that
 * isn't hand-tagged the way the demo corpus is — falls back to LLM extraction
 * (see extractAssumptionsWithLLM) so real, untagged documents still surface
 * assumptions instead of silently contributing none.
 */
export async function extractLiveAssumptions(): Promise<Assumption[]> {
  const byId = new Map<string, Assumption>();
  for (const a of extractAssumptions()) byId.set(a.id, a);

  let liveArtifacts: RawArtifact[];
  try {
    liveArtifacts = await listArtifacts();
  } catch {
    return Array.from(byId.values()); // Cognee unreachable — static list is still a valid fallback
  }

  for (const artifact of liveArtifacts) {
    const regexFound = assumptionsFromContent(artifact.content);
    for (const found of regexFound) {
      if (byId.has(found.id)) continue;
      byId.set(found.id, {
        id: found.id,
        text: found.text,
        sourceArtifact: artifact.id,
        sourceTitle: artifact.title || artifact.id,
        date: artifact.date,
        extractedBy: "regex",
      });
    }

    if (regexFound.length > 0) continue; // already covered — skip the LLM fallback for this artifact

    // Never run assumption extraction over the detector's OWN written-back
    // notes — same contamination class as cloud.ts's recall() skip logic:
    // without this, the LLM "extracts assumptions" from our own generated
    // conclusions (e.g. "the confidence level is sufficient for planning"),
    // which is noise, not a real document.
    if (artifact.content.trimStart().startsWith("[DETECTOR FINDING]")) continue;

    let llmFound = llmAssumptionCache.get(artifact.id);
    if (llmFound === undefined) {
      llmFound = await extractAssumptionsWithLLM(artifact.content);
      llmAssumptionCache.set(artifact.id, llmFound);
    }
    // Derived from the artifact's own (stable) id + position, not a running
    // counter — a counter would reassign different ids to the same
    // assumption across calls if artifact order or count ever changes,
    // breaking /api/detect's by-id lookup between when the UI fetches this
    // list and when it later submits a selection from it.
    for (const [i, found] of llmFound.entries()) {
      const id = `L-${artifact.id.slice(0, 8)}-${i + 1}`;
      byId.set(id, {
        id,
        text: found.text,
        sourceArtifact: artifact.id,
        sourceTitle: artifact.title || artifact.id,
        date: artifact.date,
        extractedBy: "llm",
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

function parseVerdict(answer: string): {
  verdict: "contradicted" | "valid" | "uncertain";
  confidence: number;
  conflictingEvidence: string | null;
  conflictingSource: string | null;
  conflictingDate: string | null;
} {
  const lower = answer.toLowerCase();

  const contradictionSignals = [
    "violated",
    "contradicted",
    "invalidated",
    "superseded",
    "no longer valid",
    "no longer true",
    "definitively violated",
    "is broken",
    "was broken",
    "exceeded",
    "surpassed",
    "far exceeds",
    "50x higher",
    "500,000",
    "500k mau",
    "8,200 tps",
    "oom",
    "out of memory",
  ];

  const validSignals = [
    "still valid",
    "still holds",
    "still true",
    "not contradicted",
    "remains valid",
    "holds true",
    "within the expected",
    "assumption holds",
  ];

  const contradictionScore = contradictionSignals.filter((s) =>
    lower.includes(s)
  ).length;
  const validScore = validSignals.filter((s) => lower.includes(s)).length;

  let verdict: "contradicted" | "valid" | "uncertain";
  let confidence: number;

  if (contradictionScore >= 2) {
    verdict = "contradicted";
    confidence = Math.min(0.95, 0.7 + contradictionScore * 0.05);
  } else if (contradictionScore === 1 && validScore === 0) {
    verdict = "contradicted";
    confidence = 0.75;
  } else if (validScore >= 1 && contradictionScore === 0) {
    verdict = "valid";
    confidence = Math.min(0.9, 0.65 + validScore * 0.05);
  } else if (contradictionScore > 0 && validScore > 0) {
    verdict = "uncertain";
    confidence = 0.5;
  } else {
    verdict = "uncertain";
    confidence = 0.3;
  }

  let conflictingEvidence: string | null = null;
  let conflictingSource: string | null = null;
  let conflictingDate: string | null = null;

  if (verdict === "contradicted") {
    const mauMatch = answer.match(
      /(\d{3},?\d{3})\s*(MAU|monthly.active|users)/i
    );
    if (mauMatch) conflictingEvidence = `Actual: ${mauMatch[1]} ${mauMatch[2]}`;

    const tpsMatch = answer.match(/(\d{1,2},?\d{3})\s*TPS/i);
    if (tpsMatch)
      conflictingEvidence = `Actual write throughput: ${tpsMatch[1]} TPS`;

    const sourceMatch = answer.match(
      /(growth report|postmortem|Q[1-4]\s*\d{4}|ADR-\d+|RFC-\d+)/i
    );
    if (sourceMatch) conflictingSource = sourceMatch[1];

    const dateMatch = answer.match(
      /(20\d{2}-\d{2}-\d{2}|Q[1-4]\s*20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+20\d{2})/i
    );
    if (dateMatch) conflictingDate = dateMatch[1];
  }

  return { verdict, confidence, conflictingEvidence, conflictingSource, conflictingDate };
}

interface StructuredVerdict {
  verdict: "contradicted" | "valid" | "uncertain";
  confidence: number;
  conflictingEvidence: string | null;
  conflictingSource: string | null;
  conflictingDate: string | null;
}

/**
 * Same job as parseVerdict(), but asks the LLM to read Cognee's own COT
 * answer and return the verdict as structured JSON, instead of us re-deriving
 * it by scanning for hardcoded phrases ("invalidated", "still valid", ...).
 * The keyword approach only recognizes wording we thought to hardcode — a
 * correct COT answer phrased any other way ("the assumption no longer
 * holds") would get silently misclassified as uncertain. This is one Groq
 * call over TEXT WE ALREADY HAVE (no extra Cognee round-trip, so no added
 * exposure to Cognee's own flakiness) — but it's still a second network call
 * that can itself fail, so callers must treat it as best-effort and fall
 * back to parseVerdict(), never as the only path.
 */
async function structureVerdictWithLLM(
  rawCotAnswer: string,
  assumption: Assumption,
): Promise<StructuredVerdict | null> {
  const prompt = [
    `An engineering assumption: "${assumption.id}: ${assumption.text}" (made ${assumption.date}, in ${assumption.sourceTitle}).`,
    `A reasoning pass over the team's records produced this answer:`,
    `"""${rawCotAnswer.slice(0, 3000)}"""`,
    ``,
    `Based ONLY on that answer, classify the assumption's current status.`,
    `Respond with strict JSON:`,
    `{"verdict": "contradicted" | "valid" | "uncertain", "confidence": 0.0-1.0,`,
    ` "conflictingEvidence": string or null (the specific conflicting fact/number, if contradicted),`,
    ` "conflictingSource": string or null (the document that contradicts it, if named),`,
    ` "conflictingDate": string or null (that document's date, if given)}`,
    `Use "uncertain" if the answer doesn't clearly say either way. Don't invent evidence not present in the answer.`,
  ].join("\n");

  try {
    const parsed = await groqCompleteJSON<Partial<StructuredVerdict>>([{ role: "user", content: prompt }]);
    if (parsed.verdict !== "contradicted" && parsed.verdict !== "valid" && parsed.verdict !== "uncertain") {
      return null; // malformed — let the caller fall back to regex
    }
    return {
      verdict: parsed.verdict,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      conflictingEvidence: parsed.conflictingEvidence ?? null,
      conflictingSource: parsed.conflictingSource ?? null,
      conflictingDate: parsed.conflictingDate ?? null,
    };
  } catch {
    return null;
  }
}

export async function detectContradiction(
  assumption: Assumption
): Promise<ContradictionFinding> {
  const query = [
    `Given this engineering assumption "${assumption.id}: ${assumption.text}"`,
    `made on ${assumption.date} in ${assumption.sourceTitle},`,
    `does any later decision, outcome, growth report, postmortem,`,
    `or document in our records contradict, invalidate, or supersede it?`,
    `If yes, cite the specific conflicting fact, its source document, and its date.`,
    `If no, state that the assumption still holds.`,
  ].join(" ");

  const result = await recall(query, "GRAPH_COMPLETION_COT");
  const rawAnswer =
    typeof result.answer === "string"
      ? result.answer
      : JSON.stringify(result, null, 2);

  const llmVerdict = await structureVerdictWithLLM(rawAnswer, assumption);
  const parsed = llmVerdict ?? parseVerdict(rawAnswer);

  return {
    assumption,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    conflictingEvidence: parsed.conflictingEvidence,
    conflictingSource: parsed.conflictingSource,
    conflictingDate: parsed.conflictingDate,
    reason: rawAnswer.slice(0, 500),
    rawCotAnswer: rawAnswer,
    verdictSource: llmVerdict ? "llm" : "regex",
  };
}

/**
 * Writes the detector's verdict back into Cognee as an explicit fact, tagged
 * so cognify's ontology prompt is allowed to extract it as an
 * Assumption -[:INVALIDATED_BY]-> Source edge (see ontology.ts). This is what
 * makes the edge real and queryable, not just a value computed in this pass.
 */
function buildInvalidationFact(finding: ContradictionFinding): string {
  return [
    `[DETECTOR FINDING] Assumption ${finding.assumption.id} ("${finding.assumption.text}")`,
    `from ${finding.assumption.sourceTitle} (${finding.assumption.date})`,
    `is INVALIDATED_BY ${finding.conflictingSource ?? "later evidence in the corpus"}`,
    finding.conflictingDate ? `dated ${finding.conflictingDate}` : "",
    finding.conflictingEvidence ? `— ${finding.conflictingEvidence}.` : ".",
    `Confidence: ${finding.confidence.toFixed(2)}. Detected ${new Date().toISOString()}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function runDetector(options: { persist?: boolean } = {}): Promise<DetectorReport> {
  const { persist = true } = options;
  const assumptions = await extractLiveAssumptions();

  // Run every assumption's COT check concurrently instead of one at a time —
  // sequential awaits here meant N assumptions took N x ~40s (measured),
  // which already risked a Vercel function timeout at just 7-8 assumptions
  // and only gets worse as more get added via the live-upload feature.
  const findings = await Promise.all(
    assumptions.map(async (assumption): Promise<ContradictionFinding> => {
      try {
        return await detectContradiction(assumption);
      } catch (err) {
        return {
          assumption,
          verdict: "uncertain",
          confidence: 0,
          conflictingEvidence: null,
          conflictingSource: null,
          conflictingDate: null,
          reason: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
          rawCotAnswer: "",
        };
      }
    }),
  );

  const contradicted = findings.filter((f) => f.verdict === "contradicted").length;
  const valid = findings.filter((f) => f.verdict === "valid").length;
  const uncertain = findings.filter((f) => f.verdict === "uncertain").length;

  let persisted = false;
  const contradictedFindings = findings.filter((f) => f.verdict === "contradicted");
  if (persist && contradictedFindings.length > 0) {
    await Promise.all(
      contradictedFindings.map((f) => remember(buildInvalidationFact(f), ["detector_findings"])),
    );
    await cognify(); // incremental — only the new detector notes get processed under the ontology prompt
    persisted = true;
  }

  return {
    runAt: new Date().toISOString(),
    findings,
    persisted,
    persistedCount: persisted ? contradictedFindings.length : 0,
    summary: {
      total: findings.length,
      contradicted,
      valid,
      uncertain,
    },
  };
}
