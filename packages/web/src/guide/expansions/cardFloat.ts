/**
 * Floating vs inline conversation cards (issue #167).
 *
 * THE one place that decides: `shouldFloatConversation`. Everything that
 * renders an `ExpansionCard` asks this helper, so trying a different rule
 * means editing one function.
 *
 * - Hover is unchanged (hover previews live elsewhere).
 * - A clicked (open) card floats persistently above the content under it:
 *   it stays open, scrolls with the page next to its anchor, and takes no
 *   space in the flow (a zero-height `.exp-float` placeholder, so the page
 *   never reflows).
 * - A pinned card renders inline, exactly today's clicked behaviour.
 * - Pinning is per card and stored on the conversation annotation
 *   (`pinned`, default false, set through the comment PATCH), so it
 *   survives a reload. No "always pin" setting.
 * - Hunk-hosted cards (issue #138) are always inline: they replace their
 *   idle summary text in a slot that already exists for them, so there is
 *   nothing to float over. They get no pin control.
 * - × closes as today (`close` action → the card collapses to its mark;
 *   clicking the mark reopens it floating unless pinned).
 */
import type { Annotation } from "@unvibe/shared";
import { useReview } from "../../state/store.js";

/**
 * Pure rule: floating unless pinned, and never for hunk-hosted cards.
 * `pinned` is the card's stored `pinned` field.
 */
export function shouldFloatConversation(card: Pick<Annotation, "id" | "anchor">, pinned: boolean): boolean {
  if (pinned) return false;
  return card.anchor.host.kind !== "hunk";
}

/** React binding for the rule above (re-renders the card on pin toggles). */
export function useFloatingCard(card: Pick<Annotation, "id" | "anchor" | "pinned">): boolean {
  const stored = useReview((s) => s.snapshot?.annotations.find((a) => a.id === card.id)?.pinned);
  return shouldFloatConversation(card, stored ?? card.pinned);
}
