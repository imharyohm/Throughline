// Throughline ontology — the small, deliberate vocabulary the graph is built around.
//
// Cognee will extract whatever it finds, but a tight ontology keeps the 3-hop
// "why → assumption → contradiction" path the ONLY plausible route through the
// graph (see day-2 plan: "simplify corpus so the 3-hop path is the only route").
//
// Entities:   Decision · Rationale · Assumption · Outcome · Owner
// Relations:  the normal decision-graph edges PLUS the one the Contradiction
//             Detector writes on Day 2 — Assumption -[:INVALIDATED_BY]-> Source.
//
// The detector edge is NOT hand-drawn in the corpus. It is declared here so the
// graph has a defined slot for it; the detector pass discovers and writes it.

export type EntityType =
  | "Decision"
  | "Rationale"
  | "Assumption"
  | "Outcome"
  | "Owner";

export type RelationType =
  | "MOTIVATED_BY" // Decision  -> Rationale
  | "ASSUMES" // Decision  -> Assumption
  | "RESULTED_IN" // Decision  -> Outcome
  | "OWNED_BY" // Decision  -> Owner
  | "SUPERSEDES" // Decision  -> Decision (later replaces earlier)
  | "INVALIDATED_BY"; // Assumption -> Source  ← written by the Contradiction Detector

export interface EntityDef {
  type: EntityType;
  description: string;
  /** node_set tag used for scoping recall / detector passes */
  nodeSet: string;
}

export interface RelationDef {
  type: RelationType;
  from: EntityType | "Any";
  to: EntityType | "Any";
  description: string;
  /** true = produced by the detector at runtime, never authored in the corpus */
  derived?: boolean;
}

export const ENTITIES: EntityDef[] = [
  {
    type: "Decision",
    description:
      "An architectural or product choice the team committed to (an ADR, RFC, or accepted proposal).",
    nodeSet: "decisions",
  },
  {
    type: "Rationale",
    description:
      "The stated reason a Decision was made — the 'because' behind the choice.",
    nodeSet: "rationales",
  },
  {
    type: "Assumption",
    description:
      "A belief about the world that a Decision depends on and that could later turn out false (e.g. 'MAU stays below 10,000').",
    nodeSet: "assumptions",
  },
  {
    type: "Outcome",
    description:
      "Something that actually happened afterwards — a measured result, an incident, a report — that confirms or contradicts an Assumption.",
    nodeSet: "outcomes",
  },
  {
    type: "Owner",
    description: "The person or role accountable for a Decision.",
    nodeSet: "owners",
  },
];

export const RELATIONS: RelationDef[] = [
  { type: "MOTIVATED_BY", from: "Decision", to: "Rationale", description: "A decision is justified by a rationale." },
  { type: "ASSUMES", from: "Decision", to: "Assumption", description: "A decision rests on an assumption." },
  { type: "RESULTED_IN", from: "Decision", to: "Outcome", description: "A decision led to an observed outcome." },
  { type: "OWNED_BY", from: "Decision", to: "Owner", description: "A decision is owned by a person." },
  { type: "SUPERSEDES", from: "Decision", to: "Decision", description: "A later decision replaces an earlier one." },
  {
    type: "INVALIDATED_BY",
    from: "Assumption",
    to: "Any",
    description:
      "An assumption is contradicted by a later source (Outcome/Decision/document). DERIVED — written by the Contradiction Detector, never authored in the corpus.",
    derived: true,
  },
];

/** node_set tags, derived from the ontology so corpus + client stay in sync. */
export const NODE_SETS = ENTITIES.map((e) => e.nodeSet);

/**
 * Steers Cognee's entity/relation extraction toward the ontology above.
 * Passed to cognify as `custom_prompt` (day-1 "Problems → fixes": tighten the
 * ontology + add a custom_prompt when extraction is noisy).
 */
export const COGNIFY_CUSTOM_PROMPT = `You are building a software-team DECISION graph. Extract ONLY these entity types and relations.

ENTITIES
${ENTITIES.map((e) => `- ${e.type}: ${e.description}`).join("\n")}

RELATIONS
${RELATIONS.map((r) => `- (${r.from}) -[:${r.type}]-> (${r.to}): ${r.description}`).join("\n")}

RULES
- Every Decision should connect to its Rationale, the Assumptions it rests on, its Owner, and any Outcome it produced.
- Capture Assumptions as their own nodes with the exact claim text (e.g. "MAU will remain below 10,000 for 18 months"). These are what the contradiction detector compares against later.
- Do NOT infer or invent an INVALIDATED_BY edge yourself. Only extract it when a document literally and explicitly states that an assumption was invalidated/contradicted — in practice this is limited to notes tagged "[DETECTOR FINDING]", which are written by a separate contradiction-detection pass, not to any ADR/RFC/meeting/commit/report source document.
- Preserve dates on every node so temporal ordering (what was believed when) is queryable.`;

/**
 * The relation the detector emits. Kept here so the detector pass and any graph
 * rendering reference one definition.
 */
export const DETECTOR_EDGE = RELATIONS.find((r) => r.type === "INVALIDATED_BY")!;
