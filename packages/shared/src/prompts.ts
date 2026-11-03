/**
 * Prompt-system contract (PRD §13, §4.14, §9.1).
 *
 * Additive contract for the prompts + context milestone: template names,
 * layer names, and layer spans for the `GET /api/prompts?review=:id`
 * expanded view. Service renders the text; web renders the spans.
 * Does not change any existing type.
 */

/** Every template in the PRD §13 table, in pipeline order. */
export const PROMPT_TEMPLATE_NAMES = [
  "instructions",
  "reader",
  "base_pack",
  "critic",
  "hunk_pass",
  "plotline_assign",
  "concept_page",
  "ask",
  "ask_turn",
  "depth",
  "examples",
  "diagram",
  "go_deeper",
  "update_pass",
  "consolidate",
  "persona_card",
] as const;

export type PromptTemplateName = (typeof PROMPT_TEMPLATE_NAMES)[number];

/** Context layers (PRD §9.1): least likely to change first. */
export type PromptLayerName = "L0" | "L1" | "L1b" | "L2" | "L3" | "L4";

/**
 * One marked span of an expanded prompt: which layer it came from, its
 * token count, and whether it is served from the provider cache
 * (the "cached part set apart" in §4.14).
 */
export interface PromptLayerSpan {
  layer: PromptLayerName;
  /** What this span holds, e.g. `instructions`, `source`, `critic task`. */
  label: string;
  tokens: number;
  cached: boolean;
}

/** Persona task templates (issue #349): the card task plus the shared Explain / Ask / depth / examples / diagram / concept tasks. */
export const PERSONA_TASK_TEMPLATES = ["persona_card", "ask", "ask_turn", "depth", "examples", "diagram", "concept_page"] as const;

export type PersonaTaskTemplate = (typeof PERSONA_TASK_TEMPLATES)[number];
