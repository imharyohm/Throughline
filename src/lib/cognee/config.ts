import type { CogneeTarget } from "./types";

// Central resolution of "which engine + where". The ONLY file that reads the
// COGNEE_* env vars. Day-3 swap = set COGNEE_TARGET=cloud; nothing else moves.

export function resolveTarget(): CogneeTarget {
  const raw = (process.env.COGNEE_TARGET ?? "local").toLowerCase();
  if (raw === "cloud" || raw === "local" || raw === "mock") return raw;
  throw new Error(
    `Invalid COGNEE_TARGET="${raw}". Expected one of: local | cloud | mock.`,
  );
}

export const DATASET = process.env.COGNEE_DATASET ?? "throughline_demo";

// Session id for the Cloud session-memory layer (QA/feedback entries used by
// improve() — see cloud.ts). Fixed per deployment so reinforced Q&A accumulates
// in one place instead of scattering across per-request random ids.
export const SESSION_ID = process.env.COGNEE_SESSION_ID ?? "throughline-demo-session";

// ── Cloud (cogwit / api.cognee.ai) ──────────────────────────────────────────
// Day-3 plan: base is https://api.cognee.ai, all paths under /api/v1, auth via
// X-Api-Key. Never hit bare /api.
export const CLOUD_BASE =
  process.env.COGNEE_CLOUD_URL ?? "https://api.cognee.ai/api/v1";
export const CLOUD_API_KEY = process.env.COGNEE_API_KEY ?? "";

// ── Local (self-hosted OSS Cognee REST) ─────────────────────────────────────
// docker compose exposes the backend on :8000; paths under /api/v1; auth is a
// bearer token from POST /api/v1/auth/login using the default user creds.
export const LOCAL_BASE =
  process.env.COGNEE_LOCAL_URL ?? "http://localhost:8000/api/v1";
export const LOCAL_USER = process.env.COGNEE_LOCAL_USER ?? "default@throughline.dev";
export const LOCAL_PASSWORD =
  process.env.COGNEE_LOCAL_PASSWORD ?? "throughline-dev";
