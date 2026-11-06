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
 * for Explain, Ask or depth in v1; the shape stays open for them.
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

/** One persona definition, stored in settings. */
export interface Persona {
  /** Stable id: slug of the name at creation (`second-opinion` for the built-in). */
  id: string;
  /** Display name (required, non-empty). */
  name: string;
  /** Agent provider id (e.g. `claude`, `codex`, `pi`). */
  provider: string;
  /** Model id on that provider (required, non-empty). */
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
  /** Auto-assigned from `PERSONA_COLORS` at creation; read-only in the UI. */
  color: string;
}

/** Id of the built-in Second opinion persona. */
export const BUILT_IN_PERSONA_ID = "second-opinion";

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
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: "You are a second reader: an independent reviewer who has not seen the rest of the guide, other findings, or any discussion. You read the guide's version of a card and the cited code, and judge the claims against the code. The guide's claims are hypotheses, not conclusions — verify each part against the cited code, and check the tests too when a claim is about behaviour. Push back plainly where the code shows otherwise, quoting the lines; add what is missing that the code shows. Every claim you make carries its citation.",
  cardInstruction:
    "Respond to the card: check its claims against the code, push back where it's wrong, add what's missing, don't rewrite it.",
  enabled: true,
  color: PERSONA_COLORS[0],
};

/** Fresh seed list for new settings (never share the mutable array). */
export function defaultPersonas(): Persona[] {
  return [structuredClone(SECOND_OPINION_PERSONA)];
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
  if (typeof o["provider"] !== "string" || (o["provider"] as string).trim() === "") {
    errors.push("persona provider must be a non-empty string");
  }
  if (typeof o["model"] !== "string" || (o["model"] as string).trim() === "") {
    errors.push("persona model must be a non-empty string");
  }
  if (typeof o["lens"] !== "string" || (o["lens"] as string).trim() === "") {
    errors.push("persona lens must be a non-empty string");
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
