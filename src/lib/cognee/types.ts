// Shared types for the cogneeClient. Both adapters (local + cloud) speak these.

export type CogneeTarget = "local" | "cloud" | "mock";

// Matches the live Cognee Cloud `searchType` enum (verified against the
// tenant's /openapi.json — the OSS client's INSIGHTS type isn't valid there).
export type SearchType =
  | "GRAPH_COMPLETION_COT" // multi-hop chain-of-thought over the graph (the headline)
  | "GRAPH_COMPLETION" // single-pass graph answer
  | "TEMPORAL" // "what did we believe when…"
  | "RAG_COMPLETION" // plain RAG, no graph (the "before" in the before/after demo)
  | "CHUNKS"; // raw retrieved chunks

export interface RecallOptions {
  /** Skip LLM completion, return retrieved context only. */
  onlyContext?: boolean;
  /** Ask the engine to include source/provenance references in the answer. */
  includeReferences?: boolean;
  /** Scope the search to a session's cached QA/trace entries (see improve()). */
  sessionId?: string;
  /** Which memory sources to search: 'graph' | 'session' | 'trace' | 'all' | 'auto' | ... */
  scope?: string | string[];
  /** Restrict results to these node_sets (allow-list — see /v1/add's node_set). */
  nodeName?: string[];
}

export interface RecallResult {
  /** Natural-language answer (GRAPH_COMPLETION* / TEMPORAL / RAG_COMPLETION). */
  answer?: string;
  /** Retrieved context / chunks the answer was grounded in. */
  context?: unknown;
  /** Subgraph lit up for this query, when the target returns one. */
  subgraph?: unknown;
  /** Which engine produced this (useful in the UI + verify.sh). */
  target?: CogneeTarget;
  /** Where the answer was actually resolved from ('graph' | 'session' | ...) — proves reinforcement worked. */
  source?: string;
  [key: string]: unknown;
}

export interface RememberResult {
  id?: string;
  dataset?: string;
  [key: string]: unknown;
}

/**
 * A specific Q&A pair to reinforce via improve(). The Cloud tenant has no
 * memify/importance_weight endpoint (verified against /openapi.json) — the
 * nearest real equivalent is recording the pair as session memory and
 * attaching positive feedback to it, so a follow-up recall scoped to the
 * session resolves it from reinforced memory instead of a fresh graph pass.
 */
export interface ImproveInput {
  question: string;
  answer: string;
  /** Reinforcement strength. Clamped to a small bounded range by the adapter. */
  score?: number;
}

/**
 * The single surface every caller in the app uses. Routes, the detector, and
 * verify.sh import ONLY this — never an adapter directly. Swapping engines is
 * one env var (COGNEE_TARGET), not a code change anywhere downstream.
 */
export interface CogneeAdapter {
  readonly target: CogneeTarget;

  /** Ingest one artifact's text, tagged into node_sets for later scoping. */
  remember(text: string, nodeSet?: string[]): Promise<RememberResult>;

  /** Build/refresh the knowledge graph for the dataset. */
  cognify(customPrompt?: string): Promise<unknown>;

  /** Query the graph. Defaults to the multi-hop COT path. */
  recall(query: string, queryType?: SearchType, opts?: RecallOptions): Promise<RecallResult>;

  /** Reinforce a specific Q&A pair (see ImproveInput). No-op if omitted. */
  improve(input?: ImproveInput): Promise<unknown>;

  /** Retract memory. memory_only=true keeps raw files, drops graph nodes. */
  forget(dataId?: string, memoryOnly?: boolean): Promise<unknown>;

  /** Cognify progress for the dataset. */
  status(): Promise<unknown>;

  /** Real HTML/D3 graph visualization for the dataset (Cognee's own renderer). */
  visualize(): Promise<string>;

  /**
   * List every artifact actually remembered into the dataset, with its raw
   * text — the live source of truth, not the static demo corpus file. Lets
   * assumption extraction pick up anything ingested after startup (e.g. via
   * the live-upload feature), not just the 7 artifacts baked into
   * data/corpus/index.ts.
   */
  listArtifacts(): Promise<RawArtifact[]>;
}

export interface RawArtifact {
  id: string;
  /** Parsed from the "[TYPE] Title" header this app writes on ingest, when present. */
  title: string;
  date: string;
  type: string;
  content: string;
}
