import { CLOUD_API_KEY, CLOUD_BASE, DATASET, SESSION_ID } from "./config";
import type {
  CogneeAdapter,
  ImproveInput,
  RecallOptions,
  RecallResult,
  RememberResult,
  SearchType,
} from "./types";

// Cloud adapter — Cognee Cloud, the submission target.
//
// Verified against the live tenant's /openapi.json (Jul 1). This is a newer
// "agent memory" API, not the raw OSS cognee surface the original plan assumed:
//   - There is NO /improve or /memify endpoint, and no importance_weight param
//     (bug #3498 is moot here — there's nothing to bound). The nearest real
//     equivalent to "reinforce a rationale" is /remember/entry: a QA entry plus
//     a FeedbackEntry chained to it via qa_id.
//   - Request bodies are camelCase (searchType, memoryOnly, dataId, datasetId),
//     NOT snake_case — sending snake_case fields gets silently dropped by the
//     server's schema and falls back to defaults.
//   - /remember is multipart/form-data (file upload + datasetName); every
//     other JSON endpoint needs a trailing slash or it 307-redirects (fetch
//     follows this automatically, curl needs -L).
//   - /recall returns a JSON ARRAY of result objects, not the {0: {...}} dict
//     shape assumed earlier (harmless coincidence: raw[0] and raw["0"] are the
//     same lookup on a JS array, so old code happened to still work).
//   - /visualize?dataset_id=<uuid> returns Cognee's own interactive D3 HTML
//     graph — real subgraph data, no custom viz code needed.
//   - /recall intermittently 409s ("An error occurred during recall.") on an
//     otherwise-valid request, especially TEMPORAL — confirmed by re-sending
//     the identical body, which then succeeds. One retry papers over it.
//   - /recall's own `source` field under-reports: GET /sessions/{id} can show
//     `used_session_context_ids` populated (session content genuinely used)
//     while /recall's top-level source still just says "graph". recall() below
//     cross-checks the session directly so the UI's source badge is accurate.
//   - Feedback recorded via /remember/entry is stored but structurally inert:
//     the response's memify_metadata.feedback_weights_applied stays false
//     forever — there is no endpoint on this tenant that ever applies it.

// /recall's 409 ("An error occurred during recall.") is opaque transient
// backend flakiness, not a request-shape error — resending the identical body
// unchanged can succeed on a later attempt (confirmed live: a TEMPORAL query
// failed on attempt 1, then succeeded twice in a row on attempts 2 and 3 with
// no change to the request). One retry isn't reliably enough headroom; back
// off with increasing delay across a few attempts instead of giving up fast.
async function req<T>(method: string, path: string, body?: unknown, retriesOn409 = 3): Promise<T> {
  const url = `${CLOUD_BASE}${path}${path.endsWith("/") ? "" : "/"}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": CLOUD_API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 409 && retriesOn409 > 0) {
    const attempt = 4 - retriesOn409; // 1st retry=1, 2nd=2, 3rd=3
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return req<T>(method, path, body, retriesOn409 - 1);
  }
  if (!res.ok) {
    throw new Error(`Cognee cloud ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

let cachedDatasetId: string | null = null;

async function resolveDatasetId(): Promise<string> {
  if (cachedDatasetId) return cachedDatasetId;
  const datasets = await req<{ id: string; name: string }[]>("GET", "/datasets");
  const match = datasets.find((d) => d.name === DATASET);
  if (!match) throw new Error(`Dataset "${DATASET}" not found on this tenant`);
  cachedDatasetId = match.id;
  return cachedDatasetId;
}

export const cloudAdapter: CogneeAdapter = {
  target: "cloud",

  async remember(text: string, nodeSet: string[] = ["decisions"]): Promise<RememberResult> {
    const boundary = `----CogneeFormBoundary${Date.now()}`;
    // node_set (snake_case here — this multipart endpoint is the one
    // inconsistency in an otherwise-camelCase API) tags extracted nodes so
    // recall's nodeName param can later scope to them. A repeated form field
    // per array entry is how FastAPI expects a List[str] over multipart.
    const nodeSetParts = nodeSet.flatMap((set) => [
      `--${boundary}`,
      `Content-Disposition: form-data; name="node_set"`,
      ``,
      set,
    ]);
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="data"; filename="artifact.txt"`,
      `Content-Type: text/plain`,
      ``,
      text,
      `--${boundary}`,
      `Content-Disposition: form-data; name="datasetName"`,
      ``,
      DATASET,
      ...nodeSetParts,
      `--${boundary}--`,
    ].join("\r\n");

    const url = `${CLOUD_BASE}/remember/`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": CLOUD_API_KEY,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Cognee cloud POST /remember → ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<RememberResult>;
  },

  cognify(customPrompt?: string): Promise<unknown> {
    return req("POST", "/cognify", {
      datasets: [DATASET],
      ...(customPrompt ? { customPrompt } : {}),
    });
  },

  async recall(
    query: string,
    queryType: SearchType = "GRAPH_COMPLETION_COT",
    opts: RecallOptions = {},
  ): Promise<RecallResult> {
    const raw = await req<unknown>("POST", "/recall", {
      query,
      searchType: queryType,
      datasets: [DATASET],
      ...(opts.onlyContext !== undefined ? { onlyContext: opts.onlyContext } : {}),
      ...(opts.includeReferences !== undefined ? { includeReferences: opts.includeReferences } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.nodeName ? { nodeName: opts.nodeName } : {}),
    });

    // /recall returns a JSON array of result objects (one per matched chunk/answer).
    // Skip our own [DETECTOR FINDING] notes (written back to Cognee so the
    // ontology can extract INVALIDATED_BY — see detector.ts) when picking the
    // headline result: on CHUNKS/SUMMARIES a detector note can outscore the
    // original source text, which quietly turns a "raw, no-reasoning"
    // baseline into one that leaks our own pre-digested conclusion.
    const candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const first = (candidates.find(
      (c) => !(c as Record<string, unknown>)?.text?.toString?.().startsWith("[DETECTOR FINDING]"),
    ) ?? candidates[0]) as Record<string, unknown> | undefined;
    const answer = (first?.text as string) ?? (first?.value as string) ?? "";
    let source = first?.source as string | undefined;

    // /recall's own `source` only names which result kind came back first — it
    // does NOT say whether session-cached feedback was blended into a
    // graph-sourced answer. Confirmed via GET /sessions/{id}: a query can carry
    // `used_session_context_ids` (proof the session contributed) while the
    // top-level source still just says "graph". Cross-check the session
    // directly so the UI's source badge is honest instead of under-reporting.
    if (opts.sessionId && source !== "session") {
      try {
        const session = await req<{
          qas?: { time: string; used_session_context_ids?: string[] | null }[];
        }>("GET", `/sessions/${encodeURIComponent(opts.sessionId)}`, undefined, 0);
        const qas = session.qas ?? [];
        const latest = qas[qas.length - 1];
        if (latest?.used_session_context_ids?.length) {
          source = source ? `${source}+session` : "session";
        }
      } catch {
        // Best-effort cross-check — never fail the recall over it.
      }
    }

    return { answer, context: raw, target: "cloud", source };
  },

  async improve(input?: ImproveInput): Promise<unknown> {
    if (!input) {
      return { status: "noop", note: "improve() needs a { question, answer } pair — pass the just-answered query." };
    }

    const qaRes = await req<Record<string, unknown>>("POST", "/remember/entry", {
      entry: {
        type: "qa",
        question: input.question,
        answer: input.answer,
        context: "Throughline contradiction detector",
      },
      dataset_name: DATASET,
      session_id: SESSION_ID,
    });

    const qaId = (qaRes.entry_id ?? qaRes.id ?? qaRes.qa_id) as string | undefined;
    if (!qaId) return { status: "ok", qa: qaRes, feedback: null };

    // No importance_weight param exists on this API (bug #3498 is moot), but we
    // still keep the reinforcement score in a small bounded range on principle.
    const score = Math.max(-2, Math.min(2, input.score ?? 2));
    const feedbackRes = await req("POST", "/remember/entry", {
      entry: {
        type: "feedback",
        qa_id: qaId,
        feedback_score: score,
        feedback_text: "Reinforced by Throughline contradiction detector",
      },
      session_id: SESSION_ID,
    });

    return { status: "ok", qaId, feedback: feedbackRes };
  },

  forget(dataId?: string, memoryOnly = true): Promise<unknown> {
    return req("POST", "/forget", {
      dataset: DATASET,
      ...(dataId ? { dataId } : {}),
      memoryOnly,
    });
  },

  status(): Promise<unknown> {
    return req("GET", `/datasets/status?datasets=${encodeURIComponent(DATASET)}`);
  },

  async visualize(): Promise<string> {
    const datasetId = await resolveDatasetId();
    const url = `${CLOUD_BASE}/visualize?dataset_id=${datasetId}`;
    const res = await fetch(url, { headers: { "X-Api-Key": CLOUD_API_KEY } });
    if (!res.ok) {
      throw new Error(`Cognee cloud GET /visualize → ${res.status}: ${await res.text()}`);
    }
    return res.text();
  },
};
