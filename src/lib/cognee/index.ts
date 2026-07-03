// cogneeClient — the single abstraction the whole app calls.
//
// Everything (API routes, the contradiction detector, verify.sh) imports from
// "@/lib/cognee" and never touches an adapter directly. Switching engines is one
// env var: COGNEE_TARGET=local | cloud | mock. That is the entire Day-3 swap.

import { COGNIFY_CUSTOM_PROMPT } from "@/lib/ontology";
import { resolveTarget, SESSION_ID } from "./config";
import { cloudAdapter } from "./cloud";
import { localAdapter } from "./local";
import { mockAdapter } from "./mock";
import type {
  CogneeAdapter,
  ImproveInput,
  RecallOptions,
  RecallResult,
  RememberResult,
  SearchType,
} from "./types";

export type { CogneeAdapter, ImproveInput, RecallOptions, RecallResult, RememberResult, SearchType };
export type { CogneeTarget } from "./types";
export { SESSION_ID };

function selectAdapter(): CogneeAdapter {
  switch (resolveTarget()) {
    case "cloud":
      return cloudAdapter;
    case "mock":
      return mockAdapter;
    case "local":
    default:
      return localAdapter;
  }
}

// Resolved once per server process. Restart dev server after changing the target.
const client = selectAdapter();

/** Which engine is live — surfaced in the UI and verify.sh. */
export const activeTarget = client.target;

// ── verbs (stable signatures the routes already use) ────────────────────────

export function remember(text: string, nodeSet: string[] = ["decisions"]): Promise<RememberResult> {
  return client.remember(text, nodeSet);
}

/** Defaults to the ontology custom prompt so extraction always follows the ontology. */
export function cognify(customPrompt: string = COGNIFY_CUSTOM_PROMPT): Promise<unknown> {
  return client.cognify(customPrompt);
}

export function recall(
  query: string,
  queryType: SearchType = "GRAPH_COMPLETION_COT",
  opts?: RecallOptions,
): Promise<RecallResult> {
  return client.recall(query, queryType, opts);
}

/** Reinforce a Q&A pair (e.g. a detector finding). No-op if no input given. */
export function improve(input?: ImproveInput): Promise<unknown> {
  return client.improve(input);
}

export function forget(dataId?: string, memoryOnly = true): Promise<unknown> {
  return client.forget(dataId, memoryOnly);
}

export function getCognifyStatus(): Promise<unknown> {
  return client.status();
}

/** Real HTML/D3 graph visualization for the dataset. */
export function visualize(): Promise<string> {
  return client.visualize();
}
