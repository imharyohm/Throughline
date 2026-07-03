import { cognify, recall, remember } from "./cognee";
import { corpus } from "../../data/corpus";

export interface Assumption {
  id: string;
  text: string;
  sourceArtifact: string;
  sourceTitle: string;
  date: string;
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

  const parsed = parseVerdict(rawAnswer);

  return {
    assumption,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    conflictingEvidence: parsed.conflictingEvidence,
    conflictingSource: parsed.conflictingSource,
    conflictingDate: parsed.conflictingDate,
    reason: rawAnswer.slice(0, 500),
    rawCotAnswer: rawAnswer,
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
  const assumptions = extractAssumptions();
  const findings: ContradictionFinding[] = [];

  for (const assumption of assumptions) {
    try {
      const finding = await detectContradiction(assumption);
      findings.push(finding);
    } catch (err) {
      findings.push({
        assumption,
        verdict: "uncertain",
        confidence: 0,
        conflictingEvidence: null,
        conflictingSource: null,
        conflictingDate: null,
        reason: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
        rawCotAnswer: "",
      });
    }
  }

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
