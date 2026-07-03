"use client";

import { useState, useEffect } from "react";
import { Database, Trash2, CheckCircle, XCircle, Loader2, Wifi, WifiOff } from "lucide-react";

interface StatusMsg {
  type: "success" | "error" | "loading";
  text: string;
}

const TARGET_COLORS: Record<string, string> = {
  local: "bg-emerald-600",
  cloud: "bg-sky-600",
  mock: "bg-amber-600",
};

export default function IngestPanel() {
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const [target, setTarget] = useState<string>("…");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setTarget(d.target ?? "unknown"))
      .catch(() => setTarget("offline"));
  }, []);

  async function ingestAll() {
    setStatus({ type: "loading", text: "Ingesting all artifacts into Cognee…" });
    try {
      const res = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus({ type: "success", text: `Ingested ${data.ingested} artifacts. Graph building started.` });
    } catch (e) {
      setStatus({ type: "error", text: String(e) });
    }
  }

  async function forgetMemory() {
    setStatus({ type: "loading", text: "Forgetting graph memory (memory_only=true — raw files kept)…" });
    try {
      const res = await fetch("/api/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memoryOnly: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus({ type: "success", text: "Memory cleared. Source files remain. Re-ingest to rebuild graph." });
    } catch (e) {
      setStatus({ type: "error", text: String(e) });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Memory Controls</h2>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-white ${TARGET_COLORS[target] ?? "bg-slate-600"}`}>
          {target === "offline" ? <WifiOff size={10} /> : <Wifi size={10} />}
          {target}
        </span>
      </div>

      <button
        onClick={ingestAll}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
      >
        <Database size={15} />
        Remember (Ingest All)
      </button>

      <button
        onClick={forgetMemory}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-sm font-medium transition-colors"
      >
        <Trash2 size={15} />
        Forget (memory_only)
      </button>

      {status && (
        <div
          className={`flex items-start gap-2 rounded-lg p-3 text-xs ${
            status.type === "success"
              ? "bg-emerald-900/40 text-emerald-300"
              : status.type === "error"
              ? "bg-rose-900/40 text-rose-300"
              : "bg-slate-800 text-slate-400"
          }`}
        >
          {status.type === "loading" && <Loader2 size={14} className="mt-0.5 animate-spin shrink-0" />}
          {status.type === "success" && <CheckCircle size={14} className="mt-0.5 shrink-0" />}
          {status.type === "error" && <XCircle size={14} className="mt-0.5 shrink-0" />}
          <span>{status.text}</span>
        </div>
      )}

      <div className="border-t border-slate-700 pt-3">
        <h3 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Cognee Verbs</h3>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <span><span className="text-indigo-400 font-mono">remember</span> → ingest artifacts</span>
          <span><span className="text-sky-400 font-mono">recall</span> → multi-hop query</span>
          <span><span className="text-amber-400 font-mono">improve</span> → reinforce a Q&amp;A (click Reinforce on an answer)</span>
          <span><span className="text-rose-400 font-mono">forget</span> → retract memory</span>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-3">
        <h3 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Demo Corpus</h3>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <span className="text-slate-400">ADR-001</span> Postgres decision (Oct 2025)
          <span className="text-slate-400">ADR-002</span> Redis cache (Nov 2025)
          <span className="text-slate-400">RFC-003</span> Monorepo (Dec 2025)
          <span className="text-slate-400">Meeting</span> Scale revisit (Jan 2026)
          <span className="text-slate-400">Commit</span> PgBouncer (Jan 2026)
          <span className="text-amber-500/70">Growth Report</span> 500k MAU — breaks A1 (Mar 2026)
          <span className="text-rose-500/70">Postmortem</span> OOM incident (Apr 2026)
        </div>
      </div>
    </div>
  );
}
