"use client";

import IngestPanel from "@/components/IngestPanel";
import GraphPanel from "@/components/GraphPanel";
import QueryPanel from "@/components/QueryPanel";
import DetectorPanel from "@/components/DetectorPanel";

export default function Home() {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-slate-800 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-lg font-bold tracking-tight">
            <span className="text-indigo-400">Through</span>line
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Decision &amp; rationale memory agent
          </p>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          <IngestPanel />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 border-b border-slate-800 flex items-center px-4 gap-4 shrink-0">
          <span className="text-sm font-medium text-slate-400">
            Multi-hop Recall &amp; Contradiction Detection
          </span>
          <span className="text-xs text-slate-600 ml-auto font-mono">
            Cognee Cloud Track
          </span>
        </header>

        {/* Content area: query + detector side by side */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: query panel */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-slate-800">
            <QueryPanel />
          </div>

          {/* Right: detector + graph */}
          <div className="w-96 shrink-0 flex flex-col overflow-y-auto">
            <div className="p-4 border-b border-slate-800">
              <DetectorPanel />
            </div>
            <div className="p-4 flex-1 flex flex-col min-h-[400px]">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                Knowledge Graph
              </h2>
              <GraphPanel />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
