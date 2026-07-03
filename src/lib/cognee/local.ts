import {
  DATASET,
  LOCAL_BASE,
  LOCAL_PASSWORD,
  LOCAL_USER,
} from "./config";
import type {
  CogneeAdapter,
  ImproveInput,
  RecallOptions,
  RecallResult,
  RememberResult,
  SearchType,
} from "./types";

// Local adapter — self-hosted OSS Cognee REST (docker compose, :8000).
//
// The OSS server speaks add/cognify/search rather than the cloud verbs, so this
// adapter MAPS the unified interface onto those endpoints. Auth is a bearer
// token from /auth/login (default user). Exact bodies are verified Day 2 against
// the running container; any drift stays contained in this file.

let cachedToken: string | null = null;

async function token(): Promise<string> {
  if (cachedToken) return cachedToken;
  // OAuth2 password flow — form-encoded, not JSON.
  const res = await fetch(`${LOCAL_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: LOCAL_USER, password: LOCAL_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Cognee local login → ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Cognee local login returned no access_token");
  cachedToken = data.access_token;
  return cachedToken;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LOCAL_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) {
    cachedToken = null; // token expired — drop it so the next call re-logs in
  }
  if (!res.ok) {
    throw new Error(`Cognee local ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const localAdapter: CogneeAdapter = {
  target: "local",

  remember(text: string, nodeSet: string[] = ["decisions"]): Promise<RememberResult> {
    return req("POST", "/add", {
      data: text,
      datasetName: DATASET,
      node_set: nodeSet,
    });
  },

  cognify(customPrompt?: string): Promise<unknown> {
    return req("POST", "/cognify", {
      datasets: [DATASET],
      ...(customPrompt ? { custom_prompt: customPrompt } : {}),
    });
  },

  recall(query: string, queryType: SearchType = "GRAPH_COMPLETION_COT", _opts: RecallOptions = {}): Promise<RecallResult> {
    return req<RecallResult>("POST", "/search", {
      query,
      searchType: queryType,
      datasets: [DATASET],
    }).then((r) => ({ ...r, target: "local" as const }));
  },

  improve(_input?: ImproveInput): Promise<unknown> {
    // OSS memify — untested against a running container in this environment
    // (Docker not installed here, see day-1 notes). Cloud is the submission
    // target; this stays best-effort for local dev.
    return req("POST", "/memify", { datasets: [DATASET] });
  },

  forget(dataId?: string, memoryOnly = true): Promise<unknown> {
    // memory_only=true → prune graph/memory but keep the raw ingested files.
    return req("POST", "/delete", {
      dataset_name: DATASET,
      ...(dataId ? { data_id: dataId } : {}),
      mode: memoryOnly ? "soft" : "hard",
    });
  },

  status(): Promise<unknown> {
    return req("GET", `/cognify/status?dataset=${DATASET}`);
  },

  async visualize(): Promise<string> {
    return `<html><body style="font-family:monospace;color:#94a3b8;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">No graph visualization endpoint wired up for the local target.</body></html>`;
  },
};
