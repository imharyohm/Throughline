import { GROQ_API_KEY, GROQ_BASE, GROQ_MODEL } from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class GroqNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set — direct-LLM features are unavailable.");
    this.name = "GroqNotConfiguredError";
  }
}

// Every call logs to stdout with a "[groq]" prefix — `console.log` on Vercel
// Functions goes straight into `vercel logs`, so this is the only way to see
// what we actually sent/got back without a dashboard. Truncated to keep
// individual log lines readable; the full request/response never gets
// written anywhere else (not to Cognee, not to disk).
function logGroq(label: string, detail: string) {
  console.log(`[groq] ${label}: ${detail.slice(0, 300).replace(/\n/g, " ")}`);
}

async function chatRaw(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  if (!GROQ_API_KEY) throw new GroqNotConfiguredError();

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const started = Date.now();
  logGroq("request", `model=${GROQ_MODEL} json=${Boolean(opts.json)} prompt="${lastUser}"`);

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const elapsedMs = Date.now() - started;

  if (!res.ok) {
    const errText = await res.text();
    logGroq("error", `status=${res.status} elapsedMs=${elapsedMs} body="${errText}"`);
    throw new Error(`Groq ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    logGroq("error", `elapsedMs=${elapsedMs} no completion content in response`);
    throw new Error("Groq returned no completion content");
  }

  logGroq("response", `elapsedMs=${elapsedMs} content="${content}"`);
  return content;
}

/** Plain-text completion — for the degraded-mode fallback and summary rewrite. */
export function groqComplete(messages: ChatMessage[], temperature?: number): Promise<string> {
  return chatRaw(messages, { temperature });
}

/**
 * JSON-mode completion — asks Groq to return strict JSON, parses it, and
 * throws if the model didn't comply. Callers should catch and fall back to
 * a non-LLM path (this is a demo built on two flaky backends already —
 * Cognee's 409s and now a second LLM call — never let this be the only path).
 */
export async function groqCompleteJSON<T>(messages: ChatMessage[], temperature = 0): Promise<T> {
  const content = await chatRaw(messages, { json: true, temperature });
  return JSON.parse(content) as T;
}

export { GroqNotConfiguredError };
