// Central resolution for our OWN direct LLM calls — separate from Cognee.
//
// Cognee Cloud manages its own LLM internally (opaque to us — see cloud.ts's
// comments on the 409 black box). This key is for the handful of places the
// app calls an LLM directly, bypassing Cognee entirely: LLM-based assumption
// extraction on freeform uploads, the Cognee-down degraded-mode fallback,
// structured verdict extraction, and the plain-English summary rewrite.

export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
export const GROQ_BASE = "https://api.groq.com/openai/v1";
