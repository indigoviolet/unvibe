/**
 * Expansion helpers (M4 interaction; PRD §4.7).
 *
 * Pure logic, no DOM/store — unit tested:
 * - closed vs open expansions, promoted links, anchor-stale fallback;
 * - expansion preview text (first paragraph HTML → plain text);
 * - grouping expansions by host for guide/description/diff slots.
 */
import type { Annotation, Block, DepthLevel } from "@unvibe/shared";

export interface ExpansionGroup {
  open: Annotation[];
  closed: Annotation[];
  links: Annotation[];
}

/** All expansion/link annotations (closed expansions stay as dotted links). */
export function isExpansionLike(a: Annotation): boolean {
  return a.type === "expansion" || a.type === "link";
}

/** Open expansions show the card in place. */
export function isOpenExpansion(a: Annotation): boolean {
  return a.type === "expansion" && a.open && !a.promotedToPage;
}

/** Closed expansions render as dotted-link marks on the anchor text. */
export function isClosedExpansion(a: Annotation): boolean {
  return a.type === "expansion" && !a.open && !a.promotedToPage;
}

/** Promoted expansions became a page link (type "link" or promotedToPage). */
export function isPromotedLink(a: Annotation): boolean {
  return a.type === "link" || !!a.promotedToPage;
}

/** Anchor-stale fallback (PRD §4.7): show a collapsed card instead. */
export function isAnchorStale(a: Annotation): boolean {
  return !!a.anchorStale || !!a.expansion?.anchorStale;
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

/** Plain-text preview of an expansion (first non-empty block). */
export function expansionPreview(a: Annotation): string {
  const blocks = a.expansion?.blocks ?? [];
  const level = a.expansion?.level ?? "standard";
  for (const b of blocks) {
    const text = blockPlainText(b, level).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 280);
  }
  return "";
}

/** First-paragraph HTML of an expansion, for hover previews. */
export function expansionPreviewHtml(a: Annotation): string | null {
  const blocks = a.expansion?.blocks ?? [];
  const level = a.expansion?.level ?? "standard";
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
