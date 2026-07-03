# Throughline

A decision-and-rationale **memory agent** for software teams. It ingests the
scattered "why" behind a team's choices — ADRs, RFCs, meeting notes, commits,
growth reports, postmortems — into a Cognee knowledge graph, then answers
multi-hop questions like:

> **"Why did we choose Postgres, what assumption drove it, and is that assumption still true?"**

…and **flags decisions whose assumptions were later contradicted** — the moat is a
**Contradiction Detector** pass that *discovers* the conflict (Cognee does not do
this for you) and writes an explicit `Assumption -[:INVALIDATED_BY]-> Source` edge.

Built for the **Cognee Cloud track**. Uses all four verbs
(`remember` / `recall` / `improve` / `forget`) plus multi-hop COT and temporal reasoning.

## The architecture bet

Everything goes through **one swappable client** (`src/lib/cognee/`). The engine is
chosen by a single env var:

```
COGNEE_TARGET=local   # self-hosted Cognee via docker compose (Mon–Tue build)
COGNEE_TARGET=cloud   # Cognee Cloud / cogwit       (Wed swap + verify)
COGNEE_TARGET=mock    # no backend — demo-shaped responses for offline UI work
```

Swapping engines is **one env var**, never a code change. Each target lives in its
own adapter file; that is the entire Day-3 cloud cutover.

| Path | Role |
|------|------|
| `src/lib/cognee/index.ts` | `cogneeClient` — the only surface the app imports |
| `src/lib/cognee/{local,cloud,mock}.ts` | one adapter per target |
| `src/lib/cognee/config.ts` | the only reader of `COGNEE_*` env vars |
| `src/lib/ontology.ts` | Decision / Rationale / Assumption / Outcome / Owner + the detector's `INVALIDATED_BY` edge + cognify custom prompt |
| `src/lib/detector.ts` | Contradiction Detector pass (Day 2) |
| `data/corpus/index.ts` | synthetic corpus; conflict present, **no hand-drawn contradiction link** |

## Getting started

```bash
cp .env.example .env.local        # set COGNEE_TARGET; add keys

# Option A — local engine (recommended once Docker is up):
cp .env.example .env              # docker compose reads .env; set LLM_API_KEY (paid key!)
docker compose up                 # Cognee REST on http://localhost:8000/api/v1

# Option B — offline, no backend:
echo 'COGNEE_TARGET=mock' >> .env.local

npm run dev                       # http://localhost:3000
```

### API routes (all call only `cogneeClient`)

| Route | Verb |
|-------|------|
| `POST /api/ingest` | `remember` each corpus artifact → kick off `cognify` |
| `POST /api/recall` | `recall(query, queryType)` — defaults to `GRAPH_COMPLETION_COT` |
| `POST /api/improve` | Save Q&A as session feedback (no real `/improve` endpoint exists on this tenant — see below) |
| `POST /api/forget` | `forget(dataId, memoryOnly)` |
| `GET  /api/status` | cognify progress |

Search types used: `GRAPH_COMPLETION_COT` (headline multi-hop), `TEMPORAL`
("what did we believe when…"), and `RAG_COMPLETION` (the "no context" baseline in
the before/after demo).

## Known platform limitations (designed around)

- **#3520** — recall can leak across datasets → **single-dataset tenant**
  (`COGNEE_DATASET=throughline_demo`).
- **#3526** — `forget()` may keep surfacing deleted facts in recall → verified Day 3;
  fallback is the graph-endpoint view.
- **#3498** — `importance_weight >= 2.0` corrupts ranking → kept in `[0, 2]`.
- **#3627–3631** — Cognee does not auto-detect contradictions → that's exactly what
  the Contradiction Detector adds.

## Cognee Cloud API — verified directly against this tenant

The docs describe [`remember` / `improve` / `recall`](https://docs.cognee.ai/core-concepts/main-operations)
as Cognee v1.0's primary operation trio (`add`/`cognify` are called out as "legacy"
steps of the `remember` pipeline — though both are still real, working routes on
this tenant, and we use `cognify` directly). The
[`improve` page](https://docs.cognee.ai/core-concepts/main-operations/improve)
describes rich capabilities — `session_ids` bridging, `feedback_alpha`,
per-node/edge `feedback_weight`, `build_global_context_index` — that read as if
they're one call away.

**None of that is reachable over HTTP on this Cloud tenant.** We pulled the
tenant's own `/openapi.json` (served at the bare domain root, not under `/api/v1`)
and enumerated all 49 real endpoints: there is no `/improve` and no `/memify`
route anywhere. The docs describe the open-source Python SDK; the hosted Cloud API
is a narrower, different surface, and nothing on the docs pages flags that split —
we only found it by inspecting the live spec directly.

What we built instead, verified live rather than assumed:

- **`improve()` → `POST /remember/entry`.** A `QAEntry` (question+answer) plus a
  chained `FeedbackEntry` (`feedback_score`, keyed by the QA's `qa_id`) is the only
  real "this was a good answer" mechanism available here. The UI calls this
  **"Save as feedback,"** not "reinforce" or "improve," for the reason below.
- **Feedback is stored but never applied.** `GET /sessions/{id}` shows our
  feedback entry's `memify_metadata.feedback_weights_applied` permanently `false`.
  The score is recorded for provenance; nothing on this tenant ever acts on it.
  There is no `importance_weight` or `feedback_weight` parameter anywhere in the
  spec, so bug **#3498** (keep weights in `[0,2]`) is moot here — there's no
  weight to bound.
- **Session recall genuinely works, but `/recall`'s own response under-reports
  it.** `GET /sessions/{id}` can show `used_session_context_ids` populated (proof
  a later query pulled in earlier session content) while `/recall`'s top-level
  `source` field still just says `"graph"`. `cloud.ts`'s `recall()` now
  cross-checks the session directly and reports `"session"` / `"graph+session"`
  accurately instead of trusting `/recall` alone.
- **`/recall` intermittently 409s** on an otherwise-valid request (especially
  `TEMPORAL`) — reproduced by resending the identical body unchanged. One
  retry-with-backoff papers over it; this is Cloud-side flakiness, not a
  request-shape bug.
- **Request bodies must be camelCase** (`searchType`, `memoryOnly`, `dataId`) —
  the server silently drops snake_case fields and falls back to defaults instead
  of rejecting the request. This was a real, silent bug in an earlier version of
  this code: `forget()` was sending `memory_only` (snake_case), so `memoryOnly`
  was likely defaulting to `false` on every call before it was caught.
