"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Loader2,
  Scan,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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
  conflictingSource: string | null;
  conflictingDate: string | null;
  reason: string;
}

interface Report {
  runAt: string;
  findings: Finding[];
  summary: {
    total: number;
    contradicted: number;
    valid: number;
    uncertain: number;
  };
  persisted: boolean;
  persistedCount: number;
}

const VERDICT_CONFIG = {
  contradicted: {
    icon: AlertTriangle,
    color: "text-rose-400",
    bg: "bg-rose-950/50 border-rose-800/50",
    badge: "bg-rose-600",
    label: "INVALIDATED",
  },
  valid: {
    icon: CheckCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-950/50 border-emerald-800/50",
    badge: "bg-emerald-600",
    label: "VALID",
  },
  uncertain: {
    icon: HelpCircle,
    color: "text-amber-400",
    bg: "bg-amber-950/50 border-amber-800/50",
    badge: "bg-amber-600",
    label: "UNCERTAIN",
  },
} as const;

export default function DetectorPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function runDetector() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Contradiction Detector
        </h2>
        <button
          onClick={runDetector}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Scan size={12} />
          )}
          {loading ? "Scanning…" : "Run Detector"}
        </button>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Scans all assumptions via multi-hop COT queries, then judges whether
        later evidence contradicts them. Writes conceptual{" "}
        <code className="text-rose-400">:INVALIDATED_BY</code> edges.
      </p>

      {error && (
        <div className="rounded-lg p-2.5 bg-rose-900/40 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-2">
          {/* Summary bar */}
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-rose-600/20 text-rose-300">
              {report.summary.contradicted} invalidated
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300">
              {report.summary.valid} valid
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-600/20 text-amber-300">
              {report.summary.uncertain} uncertain
            </span>
          </div>

          {report.persisted && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle size={11} />
              Wrote {report.persistedCount} INVALIDATED_BY edge
              {report.persistedCount === 1 ? "" : "s"} back into Cognee
            </div>
          )}

          {/* Findings */}
          {report.findings.map((f) => {
            const cfg = VERDICT_CONFIG[f.verdict];
            const Icon = cfg.icon;
            const isExpanded = expanded === f.assumption.id;

            return (
              <div
                key={f.assumption.id}
                className={`rounded-lg border p-2.5 ${cfg.bg}`}
              >
                <button
                  onClick={() =>
                    setExpanded(isExpanded ? null : f.assumption.id)
                  }
                  className="w-full flex items-start gap-2 text-left"
                >
                  <Icon size={14} className={`mt-0.5 shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-bold text-slate-300">
                        {f.assumption.id}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${cfg.badge}`}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        {Math.round(f.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {f.assumption.text}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronUp size={12} className="text-slate-500 mt-1" />
                  ) : (
                    <ChevronDown size={12} className="text-slate-500 mt-1" />
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1.5">
                    <div className="text-[11px] text-slate-500">
                      <span className="text-slate-400">Source:</span>{" "}
                      {f.assumption.sourceTitle} ({f.assumption.date})
                    </div>
                    {f.conflictingEvidence && (
                      <div className="text-[11px] text-rose-300">
                        <span className="text-slate-400">Conflict:</span>{" "}
                        {f.conflictingEvidence}
                      </div>
                    )}
                    {f.conflictingSource && (
                      <div className="text-[11px] text-slate-400">
                        <span>Conflicting source:</span>{" "}
                        <span className="text-slate-300">
                          {f.conflictingSource}
                        </span>
                        {f.conflictingDate && ` (${f.conflictingDate})`}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500 leading-relaxed mt-1">
                      {f.reason}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="text-[10px] text-slate-600 text-right">
            Ran at {new Date(report.runAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
