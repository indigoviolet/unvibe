/**
 * Persona prompt composition (issue #349, owner decision 2026-11-03).
 *
 * A persona's prompt is composed in layers:
 * 1. **Base instructions** (`prompts/instructions.md`): format, citations
 *    and rules. Shared, unchanged.
 * 2. **Persona lens** (required): who the persona is and what it looks
 *    for. Applied to every task the persona performs — it travels in the
 *    system prompt, below the base instructions, and (issue #359,
 *    option B) at the start of every persona turn's prompt, so
 *    same-model personas forking main's shared base still see it.
 * 3. **Task template** (shared, from `prompts/`, the same templates the
 *    main guide uses): the card task is the new `persona_card.md`
 *    ("here is the guide's version of this card; write your version");
 *    Explain / Ask use `ask.md` / `ask_turn.md`; depth, examples,
 *    diagram and concept pages use their own templates unchanged.
 *
 * The persona's **card instruction** overrides the card task's default
 * for that persona (e.g. Second opinion's "respond to the card …"). When
 * it is empty, the card task's default applies. No per-task overrides
 * for Explain, Ask or depth in v1; the input shape stays open for them.
 *
 * Pure except for the template library passed in (rendered by the
 * caller from the prompts dir, as everywhere else).
 */
import type { AccessMode, Persona } from "@unvibe/shared";
import { renderTemplate, type TemplateLibrary } from "./index.js";
import { renderSystemPrompt } from "./access.js";

/**
 * Card-task default: what an empty card instruction means. Kept here
 * (not in the template) so the override decision stays testable in one
 * place and the template only carries its variables.
 */
export const DEFAULT_CARD_INSTRUCTION =
  "Here is the guide's version of this card. Write your version: cover the same ground in your own words, with your own judgement of what matters.";

export interface PersonaCardInput {
  /** Lock-down or full-access posture for the L0 render. */
  access: AccessMode;
  /** The persona's lens (required, non-empty). */
  lens: string;
  /** The guide's version of the card (text + citations). */
  card: string;
  /** The persona's card instruction; empty means the default applies. */
  cardInstruction?: string;
}

export interface PersonaPrompt {
  /** L0 base instructions + the persona lens. */
  system: string;
  /** Rendered `persona_card.md` turn. */
  turn: string;
  /** The card instruction that was actually used (override or default). */
  cardInstruction: string;
}

/**
 * Compose the system prompt + card turn for a persona run. Throws when
 * the lens is blank or `persona_card` is missing from the library.
 */
export function buildPersonaCardPrompt(lib: TemplateLibrary, input: PersonaCardInput): PersonaPrompt {
  const lens = input.lens.trim();
  if (lens === "") throw new Error("persona lens must be a non-empty string");
  const tpl = lib.get("persona_card");
  if (!tpl) throw new Error("missing prompt template persona_card");
  const cardInstruction =
    input.cardInstruction !== undefined && input.cardInstruction.trim() !== ""
      ? input.cardInstruction
      : DEFAULT_CARD_INSTRUCTION;
  const system = `${renderSystemPrompt(lib, input.access)}\n\n# Persona lens\n\n${lens}`;
  const turn = renderTemplate(tpl, { card: input.card, card_instruction: cardInstruction });
  return { system, turn, cardInstruction };
}

/** `buildPersonaCardPrompt` over a full persona definition. */
export function buildPersonaCardPromptFor(
  lib: TemplateLibrary,
  access: AccessMode,
  persona: Pick<Persona, "lens" | "cardInstruction">,
  card: string,
): PersonaPrompt {
  return buildPersonaCardPrompt(lib, {
    access,
    lens: persona.lens,
    card,
    cardInstruction: persona.cardInstruction,
  });
}
