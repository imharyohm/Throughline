"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Maximize2, X } from "lucide-react";

// Embeds Cognee's own D3 knowledge-graph visualization (GET /api/graph, which
// proxies the Cloud tenant's /visualize?dataset_id=... endpoint server-side so
// the API key never reaches the browser). Real subgraph data, no custom D3
// work — per the plan's "no custom viz" guidance.
export default function GraphPanel() {
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <>
      <div className="flex flex-col gap-2 h-full">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Live from Cognee — reflects the latest ingest/detect/forget
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setExpanded(true)}
              title="Expand to fullscreen"
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Maximize2 size={11} />
              Expand
            </button>
            <button
              onClick={() => setNonce((n) => n + 1)}
              title="Reload graph"
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw size={11} />
              Refresh
            </button>
          </div>
        </div>
        <iframe
          key={nonce}
          src={`/api/graph?t=${nonce}`}
          title="Knowledge graph"
          className="w-full flex-1 min-h-[320px] rounded-lg bg-slate-900 border border-slate-700"
        />
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="relative w-full h-full max-w-[1400px] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300 font-medium">Knowledge Graph</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNonce((n) => n + 1)}
                  title="Reload graph"
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <RefreshCw size={13} />
                  Refresh
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  title="Close (Esc)"
                  className="flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors"
                >
                  <X size={16} />
                  Close
                </button>
              </div>
            </div>
            <iframe
              key={`expanded-${nonce}`}
              src={`/api/graph?t=${nonce}`}
              title="Knowledge graph (expanded)"
              className="w-full flex-1 rounded-lg bg-slate-900 border border-slate-700"
            />
          </div>
        </div>
      )}
    </>
  );
}
