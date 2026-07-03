"use client";

import { useEffect, useState, useRef } from "react";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Paperclip,
} from "lucide-react";
import { NODE_SETS } from "@/lib/ontology";

// Text-shaped files only — commit logs, meeting notes, markdown docs. Cognee
// ingests plain text (see remember()); there's no PDF/DOCX parsing anywhere
// in this pipeline, so anything else would just get remembered as noise.
const ACCEPTED_EXTENSIONS = ".txt,.md,.markdown,.log,.diff,.patch";
const MAX_FILE_BYTES = 500_000;

interface Assumption {
  id: string;
  text: string;
  sourceArtifact: string;
  sourceTitle: string;
  date: string;
}

interface Finding {
  assumption: Assumption;
  verdict: "contradicted" | "valid" | "uncertain";
  confidence: number;
  conflictingEvidence: string | null;
}

type Phase = "idle" | "ingesting" | "building" | "detecting" | "done" | "timeout" | "error";

const POLL_INTERVAL_MS = 2000;
const POLL_CAP_MS = 35000;

export default function LiveUploadPanel() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("postmortem");
  const [content, setContent] = useState("");
  const [nodeSet, setNodeSet] = useState("outcomes");
  const [targetAssumptionId, setTargetAssumptionId] = useState("");
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const pollStartRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;
    fetch("/api/detect")
      .then((r) => r.json())
      .then((d) => setAssumptions(d.assumptions ?? []))
      .catch(() => {});
  }, [open]);

  async function pollUntilCognified(): Promise<boolean> {
    pollStartRef.current = Date.now();
    // Note: the only dataset on this tenant that ever reports
    // DATASET_PROCESSING_COMPLETED is the live target (throughline_demo_v2)
    // — the other, older dataset is permanently DATASET_PROCESSING_ERRORED
    // and never flips. So "any value is COMPLETED" is a safe proxy here
    // without needing to resolve dataset name -> id client-side.
    while (Date.now() - pollStartRef.current < POLL_CAP_MS) {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        const values = Object.values(data.result ?? {});
        if (values.includes("DATASET_PROCESSING_COMPLETED")) return true;
      } catch {
        // keep polling — a transient status-check failure isn't fatal
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setError(null);
    setFindings([]);
    setPhase("ingesting");

    try {
      const res = await fetch("/api/ingest/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, type, content, nodeSet }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setPhase("building");
      const cognified = await pollUntilCognified();

      if (!cognified) {
        setPhase("timeout");
        return;
      }

      setPhase("detecting");
      if (targetAssumptionId) {
        const detectRes = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assumptionId: targetAssumptionId }),
        });
        const detectData = await detectRes.json();
        if (!detectRes.ok) throw new Error(detectData.error);
        setFindings([detectData.finding]);
      } else {
        const detectRes = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const detectData = await detectRes.json();
        if (!detectRes.ok) throw new Error(detectData.error);
        setFindings(
          (detectData.findings ?? []).filter(
            (f: Finding) => f.verdict === "contradicted"
          )
        );
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setTitle("");
    setDate("");
    setContent("");
    setTargetAssumptionId("");
    setFindings([]);
    setError(null);
    setFileName(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);

    if (file.size > MAX_FILE_BYTES) {
      setFileError(`File too large (${Math.round(file.size / 1000)}KB) — keep it under 500KB.`);
      return;
    }

    try {
      const text = await file.text();
      setContent(text);
      if (!title.trim()) {
        // "commit-abc123.diff" -> "commit-abc123"
        setTitle(file.name.replace(/\.[^./]+$/, ""));
      }
      setFileName(file.name);
    } catch {
      setFileError("Couldn't read that file as text.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors w-full"
      >
        <UploadCloud size={15} />
        Drop in a new document (live)
      </button>
    );
  }

  const busy = phase === "ingesting" || phase === "building" || phase === "detecting";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 p-3 bg-slate-900/50">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Live document upload
        </h3>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-[11px] text-slate-500 hover:text-slate-300"
        >
          Close
        </button>
      </div>

      {phase === "idle" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Postmortem: Redis Cache Stampede)"
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600"
          />
          <div className="flex gap-2">
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="Date (YYYY-MM-DD)"
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600"
            />
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Type (e.g. postmortem)"
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors w-full"
            >
              <Paperclip size={12} />
              Upload a file
            </button>
            <span className="text-[10px] text-slate-500 truncate" title={fileName ?? undefined}>
              {fileName ?? "commit log, meeting notes, .md/.txt — or paste below"}
            </span>
          </div>
          {fileError && <div className="text-[11px] text-rose-400">{fileError}</div>}
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setFileName(null); // manual edit — the "from file X" label no longer applies
            }}
            placeholder="Document content… (or upload a file above)"
            rows={5}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 resize-none"
          />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              Node set
            </span>
            <select
              value={nodeSet}
              onChange={(e) => setNodeSet(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300"
            >
              {NODE_SETS.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              Target assumption
            </span>
            <select
              value={targetAssumptionId}
              onChange={(e) => setTargetAssumptionId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300 w-full"
            >
              <option value="">Check all assumptions (slower)</option>
              {assumptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.text.slice(0, 40)}…
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!title.trim() || !content.trim()}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
          >
            <UploadCloud size={13} />
            Remember + Cognify + Detect
          </button>
        </form>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <Loader2 size={13} className="animate-spin" />
          {phase === "ingesting" && "Saving to Cognee…"}
          {phase === "building" && "Building graph…"}
          {phase === "detecting" && "Running contradiction detector…"}
        </div>
      )}

      {phase === "timeout" && (
        <div className="rounded-lg p-2.5 bg-amber-950/40 border border-amber-800/40 text-amber-300 text-xs flex items-start gap-2">
          <Clock size={14} className="shrink-0 mt-0.5" />
          <div>
            Still building on Cognee&apos;s side — this can take a while on this
            tenant. The rehearsed answers already in the graph are unaffected;
            ask the same question in chat any time to see the pre-computed
            result.
            <button
              onClick={reset}
              className="block mt-1.5 text-amber-400 underline underline-offset-2"
            >
              Try another document
            </button>
          </div>
        </div>
      )}

      {phase === "error" && error && (
        <div className="rounded-lg p-2.5 bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs">
          {error}
          <button
            onClick={reset}
            className="block mt-1.5 text-rose-400 underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col gap-2">
          {findings.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={13} />
              Ingested and cognified — no new contradictions found.
            </div>
          ) : (
            findings.map((f) => (
              <div
                key={f.assumption.id}
                className="rounded-lg p-2.5 bg-rose-950/50 border border-rose-800/50 text-xs"
              >
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={13} className="text-rose-400 shrink-0" />
                  <span className="font-mono font-bold text-slate-300">
                    {f.assumption.id}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-rose-600">
                    INVALIDATED
                  </span>
                  <span className="text-slate-500 ml-auto">
                    {Math.round(f.confidence * 100)}%
                  </span>
                </div>
                <p className="text-slate-400">{f.assumption.text}</p>
                {f.conflictingEvidence && (
                  <p className="text-rose-300 mt-1">{f.conflictingEvidence}</p>
                )}
              </div>
            ))
          )}
          <button
            onClick={reset}
            className="text-[11px] text-slate-500 hover:text-slate-300 underline underline-offset-2"
          >
            Upload another
          </button>
        </div>
      )}
    </div>
  );
}
