// Synthetic decision corpus for Throughline demo.
// Each artifact maps to a real engineering artifact type.
// Key chain: ADR-001 chose Postgres assuming <10k users.
//            Q2-growth-report showed 500k users → assumption violated.
//            This contradiction is what Throughline's multi-hop graph surfaces.

export interface Artifact {
  id: string;
  type: "adr" | "rfc" | "meeting" | "commit" | "postmortem" | "growth-report";
  title: string;
  date: string; // ISO
  content: string;
  nodeSet: string[];
}

export const corpus: Artifact[] = [
  {
    id: "adr-001",
    type: "adr",
    title: "ADR-001: Adopt PostgreSQL as Primary Database",
    date: "2025-10-15",
    nodeSet: ["decisions", "assumptions"],
    content: `# ADR-001: Adopt PostgreSQL as Primary Database

**Status:** Accepted
**Date:** 2025-10-15
**Owner:** Priya Sharma (Backend Lead)
**Deciders:** Priya Sharma, Tom Nguyen, Lena Koch

## Context
We are building the Plinth API. At the design phase we expect a maximum of 10,000 monthly-active users (MAU) based on our Series-A projections.

## Decision
We will use PostgreSQL 16 as our single primary datastore.

## Rationale
- Postgres JSONB lets us store flexible schema fields without a separate document store.
- Our team has deep Postgres expertise; onboarding cost is zero.
- Mongo's eventual-consistency model would require extra care around financial records.
- At <10k MAU, a single Postgres primary with one read replica is more than sufficient.

## Assumptions
- **A1**: Peak MAU will remain below 10,000 for at least 18 months.
- **A2**: Write throughput will stay under 500 TPS.
- **A3**: No need for horizontal write sharding within the first two years.

## Consequences
If MAU exceeds 100k we will need to revisit connection pooling (PgBouncer), or evaluate CockroachDB / Citus for horizontal scale.

## Alternatives Considered
- **MongoDB**: Rejected. Schema flexibility not needed; consistency model too loose for finance.
- **MySQL**: Rejected. Weaker JSONB support; less team familiarity.
- **CockroachDB**: Rejected. Operational complexity unjustified at current scale.`,
  },
  {
    id: "adr-002",
    type: "adr",
    title: "ADR-002: Add Redis Cache for Session and Hot-Path Queries",
    date: "2025-11-03",
    nodeSet: ["decisions"],
    content: `# ADR-002: Add Redis Cache for Session and Hot-Path Queries

**Status:** Accepted
**Date:** 2025-11-03
**Owner:** Tom Nguyen
**Deciders:** Tom Nguyen, Priya Sharma

## Context
API p99 latency on the /recommendations endpoint hit 1.2s in staging under load testing (500 concurrent). Profiling shows 70% of the time is repeated Postgres SELECT on the same product catalogue rows.

## Decision
Deploy Redis 7 (Elasticache) as a look-aside cache. Cache TTL: 5 minutes for catalogue, 24 hours for user preferences.

## Rationale
- Redis is the lowest-effort fix; no schema changes needed.
- The cache hit ratio on catalogue rows is projected at ~85% based on access logs.
- Keeps the Postgres assumption (A1, A2 from ADR-001) valid for now.

## Assumptions
- **A4**: Cache invalidation can be handled with simple TTL; no pub/sub needed yet.
- **A5**: Hot-path data is read-heavy; writes are infrequent enough that stale reads are acceptable for 5 min.`,
  },
  {
    id: "rfc-003",
    type: "rfc",
    title: "RFC-003: Monorepo Migration (plinth-api + plinth-web)",
    date: "2025-12-01",
    nodeSet: ["decisions"],
    content: `# RFC-003: Monorepo Migration

**Status:** Accepted
**Date:** 2025-12-01
**Author:** Lena Koch

## Motivation
Deploying plinth-api and plinth-web from separate repos causes drift in shared types and requires double PRs for cross-cutting changes.

## Proposal
Migrate to a Turborepo monorepo with packages/shared for types and packages/db for Drizzle schema.

## Assumptions
- **A6**: CI build time will remain under 4 minutes with Turborepo caching.
- **A7**: The team (currently 4 engineers) will not grow beyond 8 within 12 months, keeping merge-conflict risk low.

## Accepted
Decision owner: Lena Koch. Migration scheduled for Q1 2026.`,
  },
  {
    id: "meeting-2026-01-10",
    type: "meeting",
    title: "Architecture Review — Jan 10 2026",
    date: "2026-01-10",
    nodeSet: ["decisions", "assumptions"],
    content: `# Architecture Review — 2026-01-10

**Attendees:** Priya Sharma, Tom Nguyen, Lena Koch, Raj Patel (CTO)

## Key Discussion Points

### Database Scale Revisited
Raj raised the Q4 2025 actuals: we ended the year at 38,000 MAU, 3.8x the assumption in ADR-001 (A1: <10k MAU).
Priya noted Postgres is still handling it fine — PgBouncer was added in November. We agreed to monitor but no change to the decision yet.

### Redis Cache Behaviour
Tom reported cache hit ratio is 81% (vs assumed 85%). Acceptable. A4 and A5 from ADR-002 still valid.

### Monorepo
Lena: Turborepo CI is at 3m 45s. A6 holds. Team is 5 engineers. A7 holds.

## Action Items
- Priya: Add Postgres connection-pool monitoring dashboard by Jan 31.
- Tom: Evaluate PgBouncer transaction mode vs session mode.
- Raj: Commission Q1 growth forecast from data team.`,
  },
  {
    id: "commit-abc123",
    type: "commit",
    title: "feat: add PgBouncer transaction-mode pooling",
    date: "2026-01-28",
    nodeSet: ["decisions"],
    content: `commit abc123def456
Author: Tom Nguyen <tom@plinth.io>
Date: 2026-01-28

feat: add PgBouncer transaction-mode pooling

Switched from session mode to transaction mode after load tests showed
session mode was exhausting the 100-connection Postgres limit at 40k MAU.

This is a direct mitigation for scale pressure on ADR-001 assumption A1
(designed for <10k MAU; we are now at ~45k MAU).

Closes #382.`,
  },
  {
    id: "growth-report-q1-2026",
    type: "growth-report",
    title: "Q1 2026 Growth Report — Data Team",
    date: "2026-03-31",
    nodeSet: ["assumptions", "outcomes"],
    content: `# Q1 2026 Growth Report

**Author:** Data Team (Meera Rajan)
**Date:** 2026-03-31

## Summary
Plinth reached **500,000 MAU** at end of Q1 2026, driven by the viral referral campaign launched in February.

## Key Findings

### User Growth vs Projections
| Period | Projected MAU | Actual MAU |
|--------|--------------|------------|
| Oct 2025 (baseline) | 10,000 | 8,200 |
| Q4 2025 | 12,000 | 38,000 |
| Q1 2026 | 15,000 | **500,000** |

The Q1 actuals are **50x higher** than the original Series-A projection that underpinned ADR-001.

## Implications
- **ADR-001 Assumption A1** ("MAU will remain below 10,000 for 18 months") is **definitively violated** as of Q1 2026.
- **ADR-001 Assumption A2** (write throughput < 500 TPS) — current peak is 8,200 TPS. Also violated.
- **ADR-001 Assumption A3** (no horizontal sharding for 2 years) — must be re-evaluated immediately.
- Redis is absorbing significant read traffic, partially masking Postgres pressure.

## Recommendation
Engineering should convene an emergency architecture review. Options include Citus, CockroachDB, or a CQRS split with a dedicated read store. The decision to stay on a single Postgres primary is now at significant risk.`,
  },
  {
    id: "postmortem-2026-04-02",
    type: "postmortem",
    title: "Postmortem: Postgres Primary OOM — April 2 2026",
    date: "2026-04-03",
    nodeSet: ["outcomes", "decisions"],
    content: `# Postmortem: Postgres Primary OOM Incident

**Date of Incident:** 2026-04-02 03:14 UTC
**Duration:** 47 minutes
**Severity:** SEV-1
**Owner:** Priya Sharma

## What Happened
The Postgres primary ran out of memory and OOM-killed at 03:14 UTC. The API returned 503 for 47 minutes. ~22,000 users experienced failed requests.

## Root Cause
Postgres was sized for <10,000 MAU (ADR-001 assumption A1). At 500,000 MAU the shared_buffers and work_mem configuration was inadequate. A large analytical query from the reporting pipeline held 11 GB of working memory, triggering OOM.

## Contributing Factors
- ADR-001 was never formally reviewed after Q1 2026 growth report showed 500k MAU.
- No automated alert was set on the assumption that A1 was still valid.
- PgBouncer transaction mode (added Jan 2026) masked connection exhaustion but could not prevent memory pressure.

## Action Items
1. Emergency vertical scale of Postgres primary (done).
2. Formally supersede ADR-001 — initiate ADR-004 for horizontal scale strategy.
3. Isolate analytical queries to a read replica.
4. Add assumption-monitoring to architecture reviews.

## Lessons Learned
The team had the data (Q1 growth report) that ADR-001's assumptions were broken, but there was no process to link that data back to the original architectural decision. This incident was preventable.`,
  },
];
