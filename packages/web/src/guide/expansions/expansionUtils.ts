/**
 * Conversation-card helpers (issue #136; PRD §4.7).
 *
 * Pure logic, no DOM/store — unit tested:
 * - closed vs open conversation cards, promoted links, anchor-stale fallback;
 * - card preview text (first paragraph HTML → plain text);
 * - grouping cards by host for guide/description/diff slots.
 */
import type { Thread, Block, DepthLevel, Reply } from "@unvibe/shared";

export interface ExpansionGroup {
  open: Thread[];
  closed: Thread[];
  links: Thread[];
}

/** All conversation/link annotations (closed cards stay as dotted links). */
export function isExpansionLike(a: Thread): boolean {
  return a.type === "thread" || a.type === "link";
}

/** Open conversation cards show the card in place. */
export function isOpenExpansion(a: Thread): boolean {
  return a.type === "thread" && a.open && !a.promotedToPage;
}

/** Closed conversation cards render as dotted-link marks on the anchor text. */
export function isClosedExpansion(a: Thread): boolean {
  return a.type === "thread" && !a.open && !a.promotedToPage;
}

/** Promoted cards became a page link (type "link" or promotedToPage). */
export function isPromotedLink(a: Thread): boolean {
  return a.type === "link" || !!a.promotedToPage;
}

/** Anchor-stale fallback (PRD §4.7): show a collapsed card instead. */
export function isAnchorStale(a: Thread): boolean {
  return !!a.anchorStale;
}

/** Every turn of a conversation card, in order. */
export function conversationTurns(a: Thread): Reply[] {
  return a.type === "thread" ? (a.replies ?? []) : [];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function blockPlainText(block: Block, level: DepthLevel): string {
  switch (block.type) {
    case "paragraph":
      return stripTags(
        level === "simple"
          ? (block.text.simple ?? block.text.standard)
          : level === "deep"
            ? (block.text.deep ?? block.text.standard)
            : block.text.standard,
      );
    case "list":
      return stripTags(block.items[0]?.html ?? "");
    case "code":
      return block.code;
    default:
      return "";
  }
}

/** Plain-text preview of a conversation card (first turn's first non-empty block). */
export function expansionPreview(a: Thread): string {
  const first = conversationTurns(a)[0];
  const blocks = first?.blocks ?? [];
  const level = first?.level ?? "standard";
  for (const b of blocks) {
    const text = blockPlainText(b, level).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 280);
  }
  return "";
}

/** First-paragraph HTML of a conversation card, for hover previews. */
export function expansionPreviewHtml(a: Thread): string | null {
  const first = conversationTurns(a)[0];
  const blocks = first?.blocks ?? [];
  const level = first?.level ?? "standard";
  for (const b of blocks) {
    if (b.type === "paragraph") {
      const html =
        level === "simple"
          ? (b.text.simple ?? b.text.standard)
          : level === "deep"
            ? (b.text.deep ?? b.text.standard)
            : b.text.standard;
      if (html.trim()) return html;
    }
  }
  return null;
}

/**
 * No-agent message shared by expansion/card error states. Stored errors
 * carry no code, so this stays a text match: the text fallback for
 * finding 10 (HTTP failures check `apiErrorCode` first at their site).
 */
export function isNoAgentMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /no agent configured/i.test(message);
}

/** Human no-agent copy for toasts and inline states. */
export const NO_AGENT_COPY = "The agent is turned off for this service (UNVIBE_AGENT=none)";
