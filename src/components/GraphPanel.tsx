"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

// Embeds Cognee's own D3 knowledge-graph visualization (GET /api/graph, which
// proxies the Cloud tenant's /visualize?dataset_id=... endpoint server-side so
// the API key never reaches the browser). Real subgraph data, no custom D3
// work — per the plan's "no custom viz" guidance.
export default function GraphPanel() {
  const [nonce, setNonce] = useState(0);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          Live from Cognee — reflects the latest ingest/detect/forget
        </span>
        <button
          onClick={() => setNonce((n) => n + 1)}
          title="Reload graph"
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>
      <iframe
        key={nonce}
        src={`/api/graph?t=${nonce}`}
        title="Knowledge graph"
        className="w-full flex-1 min-h-[320px] rounded-lg bg-slate-900 border border-slate-700"
      />
    </div>
  );
}
