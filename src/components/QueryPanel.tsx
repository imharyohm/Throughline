"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  Send,
  Loader2,
  Columns2,
  Sparkles,
  Check,
  AlertTriangle,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NODE_SETS } from "@/lib/ontology";

type SearchType =
  | "GRAPH_COMPLETION_COT"
  | "GRAPH_COMPLETION"
  | "TEMPORAL"
  | "RAG_COMPLETION"
  | "CHUNKS";

interface ContradictionFinding {
  assumption: { id: string; text: string; sourceTitle: string; date: string };
  verdict: "contradicted" | "valid" | "uncertain";
  confidence: number;
  conflictingEvidence: string | null;
  reason: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  queryType?: SearchType;
  contradictions?: ContradictionFinding[];
  compareRag?: string;
  raw?: unknown;
  timestamp: string;
  /** The question this answer resolves — needed to reinforce() the pair. */
  sourceQuery?: string;
  /** Where the answer was resolved from ('graph' | 'session' | ...). */
  source?: string;
  reinforced?: boolean;
  reinforcing?: boolean;
}

const SEARCH_TYPES: { value: SearchType; label: string; description: string }[] = [
  {
    value: "GRAPH_COMPLETION_COT",
    label: "COT",
    description: "Chain-of-thought over knowledge graph",
  },
  {
    value: "TEMPORAL",
    label: "Temporal",
    description: "Time-aware reasoning",
  },
  {
    value: "GRAPH_COMPLETION",
    label: "Graph",
    description: "Direct graph completion",
  },
  {
    value: "RAG_COMPLETION",
    label: "RAG",
    description: "Standard RAG (no graph context)",
  },
  {
    value: "CHUNKS",
    label: "Chunks",
    description: "Raw matching chunks",
  },
];

const DEMO_QUERIES = [
  "Why did we choose Postgres, what assumptions drove it, and are they still true?",
  "What did we believe about user growth when we chose Postgres?",
  "Which architectural decisions are at risk given our Q1 2026 growth?",
  "What happened as a result of ADR-001's assumptions being wrong?",
];

export default function QueryPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("GRAPH_COMPLETION_COT");
  const [compareMode, setCompareMode] = useState(false);
  const [sessionMemory, setSessionMemory] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(query?: string) {
    const q = query ?? input.trim();
    if (!q || loading) return;
    setInput("");

    const userMsg: Message = {
      role: "user",
      content: q,
      queryType: searchType,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const wantsDetector =
        searchType === "GRAPH_COMPLETION_COT" &&
        (compareMode || /assumption|still true|still valid|at risk|postgres|adr/i.test(q));

      const res = await fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          queryType: searchType,
          withDetector: wantsDetector,
          useSessionMemory: sessionMemory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const answer =
        typeof data.result?.answer === "string"
          ? data.result.answer
          : JSON.stringify(data.result, null, 2);

      // "Before" baseline: CHUNKS, not RAG_COMPLETION. Verified live that this
      // tenant's RAG_COMPLETION does full-context synthesis over the whole
      // corpus (it correctly answered a genuinely obscure cross-document join
      // — not a naive baseline at all on a corpus this small). CHUNKS is the
      // one search type that's honestly weak: raw retrieved text, no
      // synthesis, no verdict on whether an assumption still holds.
      // nodeName scopes retrieval to the original corpus node_sets only —
      // without it, the detector's own persisted [DETECTOR FINDING] notes
      // (node_set "detector_findings") outrank the source docs on CHUNKS,
      // which would leak our own conclusion into the "no reasoning" baseline.
      let compareRag: string | undefined;
      if (compareMode && searchType === "GRAPH_COMPLETION_COT") {
        try {
          const ragRes = await fetch("/api/recall", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q, queryType: "CHUNKS", nodeName: NODE_SETS }),
          });
          const ragData = await ragRes.json();
          if (ragRes.ok) {
            compareRag =
              typeof ragData.result?.answer === "string"
                ? ragData.result.answer
                : JSON.stringify(ragData.result, null, 2);
          }
        } catch {}
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: answer,
        contradictions: data.contradictions ?? undefined,
        compareRag,
        raw: data.result,
        sourceQuery: q,
        source: data.result?.source,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function reinforce(index: number) {
    const msg = messages[index];
    if (!msg.sourceQuery) return;
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, reinforcing: true } : m))
    );
    try {
      const res = await fetch("/api/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: msg.sourceQuery, answer: msg.content, score: 2 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, reinforcing: false, reinforced: true } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, reinforcing: false } : m))
      );
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search size={32} className="text-slate-600 mb-4" />
            <h2 className="text-lg font-semibold text-slate-300 mb-2">
              Ask about your team&apos;s decisions
            </h2>
            <p className="text-sm text-slate-500 mb-6 max-w-md">
              Throughline traces multi-hop chains through your architectural
              decisions, rationales, and assumptions — and flags when reality
              contradicts them.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-lg">
              {DEMO_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  className="text-left text-sm px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-xl px-4 py-3 ${msg.compareRag ? "max-w-[95%]" : "max-w-[85%]"} ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800 text-slate-200 border border-slate-700"
              }`}
            >
              {msg.queryType && msg.role === "user" && (
                <span className="inline-block text-[10px] font-mono uppercase tracking-wider opacity-70 mb-1">
                  {msg.queryType}
                </span>
              )}
              {msg.role === "assistant" &&
                msg.contradictions?.some((c) => c.verdict === "contradicted") && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-white shadow-sm">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span className="text-xs font-bold">
                      {msg.contradictions.filter((c) => c.verdict === "contradicted").length}{" "}
                      assumption
                      {msg.contradictions.filter((c) => c.verdict === "contradicted").length === 1
                        ? ""
                        : "s"}{" "}
                      behind this decision {msg.contradictions.filter((c) => c.verdict === "contradicted").length === 1 ? "has" : "have"} been INVALIDATED
                    </span>
                  </div>
                )}
              {msg.compareRag && (
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div className="rounded-lg border border-slate-600/40 bg-slate-950/40 p-2.5">
                    <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <XCircle size={12} />
                      Before — raw chunk retrieval (no reasoning)
                    </div>
                    <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none opacity-70">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.compareRag}
                      </ReactMarkdown>
                    </div>
                  </div>
                  <div className="rounded-lg border border-indigo-500/40 bg-indigo-950/20 p-2.5">
                    <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      After — Throughline (graph-traced)
                    </div>
                    <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
              {!msg.compareRag && (
                <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
              {msg.contradictions && msg.contradictions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-600/50 space-y-2">
                  <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
                    Contradiction Detection
                  </div>
                  {msg.contradictions.map((c) => (
                    <div
                      key={c.assumption.id}
                      className={`rounded-md p-2 text-xs ${
                        c.verdict === "contradicted"
                          ? "bg-rose-950/60 border border-rose-800/40"
                          : c.verdict === "valid"
                          ? "bg-emerald-950/60 border border-emerald-800/40"
                          : "bg-amber-950/60 border border-amber-800/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-slate-300">
                          {c.assumption.id}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${
                            c.verdict === "contradicted"
                              ? "bg-rose-600"
                              : c.verdict === "valid"
                              ? "bg-emerald-600"
                              : "bg-amber-600"
                          }`}
                        >
                          {c.verdict === "contradicted"
                            ? "INVALIDATED"
                            : c.verdict.toUpperCase()}
                        </span>
                        <span className="text-slate-500 ml-auto">
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-slate-400">{c.assumption.text}</p>
                      {c.conflictingEvidence && (
                        <p className="text-rose-300 mt-1">
                          {c.conflictingEvidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {msg.role === "assistant" && msg.sourceQuery && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center gap-2">
                  {msg.source && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        msg.source === "session"
                          ? "bg-sky-900/60 text-sky-300"
                          : "bg-slate-700/60 text-slate-400"
                      }`}
                    >
                      source: {msg.source}
                    </span>
                  )}
                  <button
                    onClick={() => reinforce(i)}
                    disabled={msg.reinforcing || msg.reinforced}
                    title="Saves this Q&A as feedback in session memory so it can be recalled later — does not reweight the graph (Cognee Cloud has no such endpoint)"
                    className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                      msg.reinforced
                        ? "text-emerald-400"
                        : "text-amber-400 hover:bg-amber-900/30"
                    } disabled:opacity-60`}
                  >
                    {msg.reinforcing ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : msg.reinforced ? (
                      <Check size={10} />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    {msg.reinforced ? "Saved as feedback" : "Save as feedback"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              Tracing knowledge graph…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-800 p-4">
        {/* Search type selector */}
        <div className="flex gap-1 mb-3">
          {SEARCH_TYPES.map((st) => (
            <button
              key={st.value}
              onClick={() => setSearchType(st.value)}
              title={st.description}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                searchType === st.value
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {st.label}
            </button>
          ))}
          <button
            onClick={() => setSessionMemory(!sessionMemory)}
            title="Resolve using saved session feedback instead of a fresh graph pass — save an answer as feedback first"
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ml-auto ${
              sessionMemory
                ? "bg-sky-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <Sparkles size={12} />
            Session memory
          </button>
          <button
            onClick={() => setCompareMode(!compareMode)}
            title="Compare COT (with graph) vs RAG (without) side by side"
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              compareMode
                ? "bg-violet-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <Columns2 size={12} />
            Compare
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about decisions, assumptions, or contradictions…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-colors"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
