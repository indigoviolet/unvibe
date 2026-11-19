/**
 * Persona model (issue #349, Personas v1 step 1).
 *
 * A persona is a named reviewer voice: provider + model, a lens (who it
 * is and what it looks for, applied to every task it performs), an
 * optional card instruction (overrides the card task's default for that
 * persona), and enabled. Colour is automatic — assigned from
 * `PERSONA_COLORS` in creation order, never user-picked — and there is
 * no icon: the AI avatar is recoloured wherever the persona speaks.
 *
 * Definitions live in settings (`Settings.personas`); the built-in
 * Second opinion below is only the seed value. No per-task overrides
 * for Explain, Ask or slower rewrites in v1; the shape stays open for them.
 *
 * Pure TypeScript: no Node or DOM APIs.
 */

/** Fixed contrasting colour sequence, legible in light and dark. */
export const PERSONA_COLORS = [
  "#0E7C86",
  "#C2410C",
  "#1D4ED8",
  "#BE123C",
  "#15803D",
  "#7C3AED",
  "#B45309",
  "#4D7C0F",
] as const;

/**
 * One persona definition, stored in settings.
 *
 * Who the persona runs as (issue #359): an explicit provider/model,
 * or the main model at run time. Stored as a required boolean (not a
 * magic model string) so old rows without it are a shape change — see
 * DATA_FORMAT 5. When true, `provider`/`model` below are the last
 * explicit pick: the seed for a fresh persona, the display fallback,
 * and the starting point if the owner pins a specific model.
 *
 * `effort` (issue #379) exists only on the Guide: the thinking level
 * for the main model, "" = the adapter default. Other personas never
 * carry it (validated).
 */
export interface Persona {
  /** Stable id: slug of the name at creation (`second-opinion` for the built-in). */
  id: string;
  /** Display name (required, non-empty). */
  name: string;
  /** True = run on `settings.main` (provider + model) at run time. */
  followMain: boolean;
  /**
   * Agent provider id (e.g. `claude`, `codex`, `pi`). Required,
   * non-empty — the last explicit pick when `followMain` is true.
   */
  provider: string;
  /**
   * Model id on that provider (required, non-empty) — the last explicit
   * pick when `followMain` is true.
   */
  model: string;
  /**
   * Who the persona is and what it looks for (required, non-empty).
   * Applied to every task the persona performs.
   */
  lens: string;
  /**
   * Overrides the card task's default for this persona. Empty means the
   * card task's default ("write your version") applies.
   */
  cardInstruction: string;
  /** Off means the persona is hidden from the run choices (kept, not deleted). */
  enabled: boolean;
  /**
   * Thinking level for the main model (issue #379) — Guide only.
   * "" = Default (the adapter's own setting stands). Absent on every
   * other persona (rejected by validation).
   */
  effort?: string;
  /** Auto-assigned from `PERSONA_COLORS` at creation; read-only in the UI. */
  color: string;
}

/** Id of the built-in Second opinion persona. */
export const BUILT_IN_PERSONA_ID = "second-opinion";

/**
 * Id of the built-in Guide persona (issue #379): the main agent. There
 * is exactly one, and it cannot be deleted or disabled. It owns the
 * main provider + model (replacing `settings.main`) and a writing-style
 * lens (empty by default). Its colour is data-only, never rendered —
 * the Guide tab stays untinted, exactly as before.
 */
export const GUIDE_PERSONA_ID = "guide";

/**
 * The built-in Second opinion persona (issue #349): seeded into fresh
 * settings. Its card instruction reproduces today's "check" behaviour —
 * review the card's claims against the code; push back, correct, add
 * what is missing; cite everything. After seeding it is an ordinary
 * entry: editable and deletable like any other persona.
 */
export const SECOND_OPINION_PERSONA: Persona = {
  id: BUILT_IN_PERSONA_ID,
  name: "Second opinion",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: "You are a second reader: an independent reviewer who has not seen the rest of the guide, other findings, or any discussion. You read the guide's version of a card and the cited code, and judge the claims against the code. The guide's claims are hypotheses, not conclusions — verify each part against the cited code, and check the tests too when a claim is about behaviour. Push back plainly where the code shows otherwise, quoting the lines; add what is missing that the code shows. Every claim you make carries its citation.",
  cardInstruction:
    "Respond to the card: check its claims against the code, push back where it's wrong, add what's missing, don't rewrite it.",
  enabled: true,
  color: PERSONA_COLORS[0],
};

/**
 * The built-in Guide persona (issue #379): the main agent itself. It
 * owns the main provider + model (replacing `settings.main`) and a
 * writing-style lens that is empty by default, so behaviour is
 * unchanged until the owner writes one. When set, the lens is prefixed
 * to every main-agent writing turn (guide, cards, slower rewrites,
 * Explain, Ask)
 * as a subordinate style section — it governs tone and wording only.
 * No card instruction (its card task is the guide's own), never offered
 * as a run choice on cards, never tinted. After seeding it stays fixed:
 * not deletable, not disableable, `followMain` always false (it IS the
 * model others follow). The colour is data-only, never rendered — the
 * Guide tab stays untinted; the long-standing slot is kept so existing
 * installs don't shift.
 */
export const GUIDE_PERSONA: Persona = {
  id: GUIDE_PERSONA_ID,
  name: "Guide",
  followMain: false,
  provider: "claude",
  model: "claude-opus-5-5",
  lens: "",
  cardInstruction: "",
  enabled: true,
  color: PERSONA_COLORS[2],
  effort: "",
};

/** Fresh seed list for new settings (never share the mutable array). */
export function defaultPersonas(): Persona[] {
  return [structuredClone(GUIDE_PERSONA), structuredClone(SECOND_OPINION_PERSONA)];
}

/** The Guide persona in a list, or undefined when absent. Pure. */
export function getGuidePersona(personas: Persona[]): Persona | undefined {
  return personas.find((p) => p.id === GUIDE_PERSONA_ID);
}

/** Colour for a creation index (wraps the sequence). Pure. */
export function personaColorAt(index: number): string {
  const i = ((Math.trunc(index) % PERSONA_COLORS.length) + PERSONA_COLORS.length) % PERSONA_COLORS.length;
  return PERSONA_COLORS[i];
}

/**
 * Colour for a new persona: the first sequence colour not already in
 * use (creation order); wraps to the start when all are taken. Pure.
 */
export function nextPersonaColor(personas: Pick<Persona, "color">[]): string {
  const used = new Set(personas.map((p) => p.color));
  for (const color of PERSONA_COLORS) {
    if (!used.has(color)) return color;
  }
  return PERSONA_COLORS[0];
}

/** True when the colour belongs to the fixed sequence. Pure. */
export function isPersonaColor(color: unknown): color is string {
  return typeof color === "string" && (PERSONA_COLORS as readonly string[]).includes(color);
}

/** Slug for a persona name (`Second opinion` → `second-opinion`). Pure. */
export function slugifyPersonaName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "persona"
  );
}

/**
 * Validate one persona definition; returns error messages (empty =
 * valid). Pure. Model-offer checks against live adapters live in the
 * settings route, next to the role checks — not here.
 */
export function validatePersona(p: unknown): string[] {
  const errors: string[] = [];
  if (typeof p !== "object" || p === null) return ["persona must be an object"];
  const o = p as Record<string, unknown>;
  if (typeof o["id"] !== "string" || o["id"].trim() === "") {
    errors.push("persona id must be a non-empty string");
  }
  if (typeof o["name"] !== "string" || o["name"].trim() === "") {
    errors.push("persona name must be a non-empty string");
  } else if (o["name"].length > 80) {
    errors.push("persona name must be at most 80 characters");
  }
  if (typeof o["followMain"] !== "boolean") {
    errors.push("persona followMain must be a boolean (true = run on the main model)");
  }
  if (typeof o["provider"] !== "string" || (o["provider"] as string).trim() === "") {
    errors.push("persona provider must be a non-empty string");
  }
  if (typeof o["model"] !== "string" || (o["model"] as string).trim() === "") {
    errors.push("persona model must be a non-empty string");
  }
  if (o["id"] === GUIDE_PERSONA_ID) {
    if (typeof o["effort"] !== "string") {
      errors.push('guide persona effort must be a string ("" = Default)');
    }
  } else if (o["effort"] !== undefined) {
    errors.push("only the Guide persona carries an effort");
  }
  if (typeof o["lens"] !== "string" || ((o["lens"] as string).trim() === "" && o["id"] !== GUIDE_PERSONA_ID)) {
    errors.push(
      o["id"] === GUIDE_PERSONA_ID
        ? "guide persona lens must be a string (empty means no writing-style lens)"
        : "persona lens must be a non-empty string",
    );
  }
  if (typeof o["cardInstruction"] !== "string") {
    errors.push("persona cardInstruction must be a string (empty means the card default applies)");
  }
  if (typeof o["enabled"] !== "boolean") {
    errors.push("persona enabled must be a boolean");
  }
  if (!isPersonaColor(o["color"])) {
    errors.push(`persona color must be one of the persona colours (${PERSONA_COLORS.join(", ")})`);
  }
  return errors;
}
