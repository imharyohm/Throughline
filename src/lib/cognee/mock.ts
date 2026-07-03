import type {
  CogneeAdapter,
  ImproveInput,
  RecallOptions,
  RecallResult,
  RememberResult,
  SearchType,
} from "./types";

// Mock adapter — no backend required.
//
// Cognee local needs Docker and Cloud opens Wed; this lets the app spine, the
// graph panel, and (Day 2) the contradiction-detector wiring run end-to-end
// offline. Responses are demo-shaped, not real graph traversals. Selected with
// COGNEE_TARGET=mock. NEVER the submission target — it proves nothing about Cognee.

const remembered: string[] = [];

// The 3-hop chain the real graph should light up, plus the detected contradiction.
const HEADLINE_SUBGRAPH = {
  nodes: [
    { id: "adr-001", name: "ADR-001: Adopt PostgreSQL", type: "decision" },
    { id: "rationale-pg", name: "Postgres JSONB + team expertise", type: "rationale" },
    { id: "owner-priya", name: "Priya Sharma", type: "owner" },
    { id: "assumption-a1", name: "MAU stays below 10,000 for 18 months", type: "assumption" },
    { id: "growth-q1", name: "Q1 2026 Growth Report: 500k MAU", type: "outcome" },
    { id: "postmortem", name: "Postgres OOM SEV-1 (Apr 2026)", type: "outcome" },
  ],
  edges: [
    { from: "adr-001", to: "rationale-pg", label: "MOTIVATED_BY" },
    { from: "adr-001", to: "owner-priya", label: "OWNED_BY" },
    { from: "adr-001", to: "assumption-a1", label: "ASSUMES" },
    { from: "assumption-a1", to: "growth-q1", label: "INVALIDATED_BY" },
    { from: "growth-q1", to: "postmortem", label: "RESULTED_IN" },
  ],
};

const HEADLINE_COT = `**Decision:** ADR-001 — adopt PostgreSQL 16 as the single primary datastore (2025-10-15, owner: Priya Sharma).

**Why (rationale):** Postgres JSONB gave schema flexibility without a second datastore, the team had deep Postgres expertise, and a single primary + one read replica was judged "more than sufficient."

**The assumption it rested on (A1):** *"Peak MAU will remain below 10,000 for at least 18 months."*

⚠️ **This assumption was INVALIDATED.** The Q1 2026 Growth Report recorded **500,000 MAU — 50× the projection** — and the April 2026 SEV-1 Postgres OOM postmortem traced the outage directly back to ADR-001's <10k sizing. **So the rationale no longer holds: the decision should be revisited.**`;

const TEMPORAL_ANSWER = `At the time ADR-001 was decided (2025-10-15), the team **believed** peak MAU would stay under 10,000 for 18 months (Series-A projection), write throughput would stay under 500 TPS, and no horizontal sharding would be needed for two years. Those were the beliefs that justified a single Postgres primary — all three were later contradicted by Q1 2026 actuals.`;

const RAG_NO_CONTEXT = `PostgreSQL is a powerful open-source relational database. Teams often choose it for its reliability, ACID compliance, and rich feature set including JSONB. Without access to your team's decision records I can't say specifically why your team picked it or whether the original assumptions still hold.`;

function answerFor(query: string, queryType: SearchType): RecallResult {
  const q = query.toLowerCase();
  const isHeadline = q.includes("postgres") || q.includes("why") || q.includes("assumption");

  if (queryType === "RAG_COMPLETION") {
    return { answer: RAG_NO_CONTEXT, target: "mock" };
  }
  if (queryType === "TEMPORAL") {
    return { answer: TEMPORAL_ANSWER, target: "mock", subgraph: HEADLINE_SUBGRAPH };
  }
  if (isHeadline) {
    return { answer: HEADLINE_COT, target: "mock", subgraph: HEADLINE_SUBGRAPH };
  }
  return {
    answer: `(mock) No canned answer for "${query}". The mock adapter only stages the headline / temporal / RAG demo paths. Use a real target for arbitrary queries.`,
    target: "mock",
  };
}

export const mockAdapter: CogneeAdapter = {
  target: "mock",

  async remember(text: string): Promise<RememberResult> {
    remembered.push(text);
    return { id: `mock-${remembered.length}`, dataset: "mock" };
  },

  async cognify(): Promise<unknown> {
    return { status: "DATASET_PROCESSING_COMPLETED", target: "mock", ingested: remembered.length };
  },

  async recall(query: string, queryType: SearchType = "GRAPH_COMPLETION_COT", _opts: RecallOptions = {}): Promise<RecallResult> {
    return answerFor(query, queryType);
  },

  async improve(input?: ImproveInput): Promise<unknown> {
    return { status: "ok", target: "mock", note: "mock reinforcement — no-op", reinforced: input ?? null };
  },

  async forget(_dataId?: string, memoryOnly = true): Promise<unknown> {
    return { status: "ok", target: "mock", memory_only: memoryOnly };
  },

  async status(): Promise<unknown> {
    return { status: "DATASET_PROCESSING_COMPLETED", target: "mock", ingested: remembered.length };
  },

  async visualize(): Promise<string> {
    const nodes = HEADLINE_SUBGRAPH.nodes.map((n, i) => ({
      ...n,
      x: 90 + (i % 3) * 160,
      y: 60 + Math.floor(i / 3) * 140,
    }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const colors: Record<string, string> = {
      decision: "#6366f1",
      assumption: "#f59e0b",
      outcome: "#10b981",
      rationale: "#3b82f6",
      owner: "#ec4899",
    };
    const edgesSvg = HEADLINE_SUBGRAPH.edges
      .map((e) => {
        const a = byId[e.from];
        const b = byId[e.to];
        if (!a || !b) return "";
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#334155" stroke-width="1.5" />
        <text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" fill="#94a3b8" font-size="9" text-anchor="middle" font-family="monospace">${e.label}</text>`;
      })
      .join("\n");
    const nodesSvg = nodes
      .map(
        (n) => `<circle cx="${n.x}" cy="${n.y}" r="18" fill="${colors[n.type] ?? "#64748b"}" stroke="#1e293b" stroke-width="2" />
      <text x="${n.x}" y="${n.y + 34}" fill="#f8fafc" font-size="10" text-anchor="middle" font-family="monospace">${n.name.slice(0, 22)}</text>`,
      )
      .join("\n");
    return `<html><body style="margin:0;background:#0f172a"><svg width="100%" height="100%" viewBox="0 0 560 350">${edgesSvg}${nodesSvg}</svg></body></html>`;
  },
};
