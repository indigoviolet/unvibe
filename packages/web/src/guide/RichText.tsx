/**
 * Rich text rendering (web-guide owner): trusted HTML with delegated
 * interactions. Dotted page links (`a.cx` with `data-node` or `data-link`)
 * navigate in-app; source buttons (`.src[data-src]`) reveal.
 * Links to fully read pages render muted with the prototype's check mark.
 * Links to unknown concepts (hidden candidates) toast instead of
 * navigating; the page is written when first opened (later milestone).
 */
import { useMemo } from "react";
import type { Page } from "@unvibe/shared";
import { api } from "../api/client.js";
import { revealSource } from "../source/reveal.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { requestGuideBlock } from "./actions.js";
import {
  cardPreview,
  markKnownLinks,
  pageIdForLinkTarget,
  pagePreview,
} from "./guideUtils.js";

interface Props {
  html: string;
  className?: string;
  /** Block id for the `data-top` selection/anchor hook (prototype). */
  top?: string;
  /** Open a guide page in-app. */
  onOpenPage: (pageId: string) => void;
}

export function resolvePageLink(
  target: string,
  pages: Page[] | undefined,
): string | null {
  if (!pages) return null;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const lookup = (id: string): Page | undefined => byId.get(id);
  const id = pageIdForLinkTarget(target, lookup);
  if (id) return id;
  if (byId.has(target)) return target;
  return null;
}

export function RichText({ html, className, top, onOpenPage }: Props) {
  const pages = useReview((s) => s.snapshot?.pages);
  const processed = useMemo(
    () => (pages ? markKnownLinks(html, pages) : html),
    [html, pages],
  );

  return (
    <span
      className={className}
      {...(top !== undefined ? { "data-top": top } : {})}
      dangerouslySetInnerHTML={{ __html: processed }}
      onClick={(e) => handleHtmlLinkClick(e, pages, onOpenPage)}
    />
  );
}

/** Shared click delegation for rendered HTML outside RichText (list items). */
export function handleHtmlLinkClick(
  e: { target: unknown; preventDefault: () => void },
  pages: Page[] | undefined,
  onOpenPage: (pageId: string) => void,
): void {
  const el = e.target as HTMLElement;
  const link = el.closest?.("a.cx[data-node], a.cx[data-link]");
  if (link) {
    e.preventDefault();
    openLinkTarget(
      link.getAttribute("data-link") ?? link.getAttribute("data-node") ?? "",
      pages,
      onOpenPage,
    );
    return;
  }
  const src = el.closest?.("[data-src]");
  if (src) {
    revealSource(src.getAttribute("data-src") ?? "");
  }
}

/** Open any dotted-link target: pages, cards (`card:id[#block]`), concepts. */
export function openLinkTarget(
  target: string,
  pages: Page[] | undefined,
  onOpenPage: (pageId: string) => void,
): void {
  const pageId = resolvePageLink(target, pages);
  if (pageId) {
    onOpenPage(pageId);
    return;
  }
  if (target.startsWith("card:")) {
    const [cardId, blockId] = target.slice("card:".length).split("#");
    const page = pages?.find((p) => p.cards.some((c) => c.id === cardId));
    if (page && cardId) {
      // The guide-block listener navigates when needed, then scrolls.
      requestGuideBlock(cardId, blockId ?? "");
      return;
    }
    toast("That card isn't in this review.");
    return;
  }
  if (target.startsWith("concept:")) {
    // Concept pages are written on first open: fire the `concept` action
    // (working state on the new page), then navigate to the stub. The stub
    // creation is synchronous in the service, so the page exists by the
    // time the action resolves; navigate optimistically and let patches
    // fill it.
    const slug = target.slice("concept:".length);
    const reviewId = useReview.getState().snapshot?.review.id;
    if (!reviewId) {
      toast("The review hasn't loaded yet.");
      return;
    }
    const stubId = `c-${slug}`;
    // If the stub already exists (empty or full), open it at once so the
    // working state is visible while the job fills it.
    if (pages?.some((p) => p.id === stubId)) {
      onOpenPage(stubId);
    }
    void api
      .action(reviewId, { kind: "concept", slug })
      .then((res) => {
        if (res.accepted && res.pageId) onOpenPage(res.pageId);
        else if (!res.accepted) toast("Needs the service to write this concept page.");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/no agent configured/i.test(msg)) {
          toast("No agent configured — set up Claude or Codex in Settings → Models to write concept pages.");
        } else {
          toast(`Couldn't open the concept: ${msg}`);
        }
      });
    // Optimistic navigation so the working state shows immediately.
    onOpenPage(stubId);
    return;
  }
  toast("That link can't be opened yet.");
}

/** Preview HTML for a dotted-link target (page title + first paragraph). */
export function previewLinkTarget(target: string, pages: Page[] | undefined): string | null {
  if (!pages) return null;
  const pageId = resolvePageLink(target, pages);
  if (pageId) {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return null;
    const first = pagePreview(page);
    return `<b>${page.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b>${first ? `<div class="xprev">${first}</div>` : ""}`;
  }
  if (target.startsWith("card:")) {
    const [cardId] = target.slice("card:".length).split("#");
    const holder = pages.find((p) => p.cards.some((c) => c.id === cardId));
    const card = holder?.cards.find((c) => c.id === cardId);
    if (!card) return null;
    const title = card.title ?? cardPreview(card).slice(0, 80);
    return `<b>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b><span class="hint">Click to open</span>`;
  }
  if (target.startsWith("concept:")) {
    const slug = target.slice("concept:".length).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<b>${slug}</b><span class="hint">Concept candidate · the page is written when first opened</span>`;
  }
  return null;
}
