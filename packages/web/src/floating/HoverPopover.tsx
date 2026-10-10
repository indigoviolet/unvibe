/**
 * Hover popover (M2, web-guide owner; PRD §4.5).
 *
 * Dotted page links preview title + first paragraph (click opens the page);
 * `<>` citation markers preview the cited lines (click reveals the source);
 * comment markers and suggested-comment links preview the thread.
 *
 * Rules (ported from the prototype):
 * - opens after ~0.2 s of hovering;
 * - closes on any scroll anywhere, press outside, Escape, window blur,
 *   pointer leaving the window, resize;
 * - after a scroll, hover is ignored until the pointer actually moves;
 * - the pointer may travel into the popover (leaving the anchor starts a
 *   short delayed close, entering the popover cancels it).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Annotation, Page } from "@unvibe/shared";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { resolveBlockCitations } from "../guide/citations.js";
import { depthText } from "../guide/guideUtils.js";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 220;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tick = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function renderMsgs(msgs: Annotation["messages"]): string {
  return msgs
    .map((m) => {
      const who = m.who === "you" ? "You" : m.suggested ? "Agent · suggested comment" : "Agent";
      const av = m.who === "you" ? "you" : "ai";
      const label = m.who === "you" ? "Me" : "AI";
      return `<div class="msg"><span class="av ${av}">${label}</span><div><div class="who">${who}</div><p>${m.html ?? tick(m.text ?? "")}</p></div></div>`;
    })
    .join("");
}

function previewThread(thread: Annotation | undefined): string {
  if (!thread) return "";
  return `<div class="pv">${thread.anchor.quotedText ? `<div class="q">“${esc(thread.anchor.quotedText)}”</div>` : ""}${renderMsgs(thread.messages.slice(0, 2))}${thread.messages.length > 2 ? `<span class="hint">+${thread.messages.length - 2} more</span>` : ""}</div>`;
}

function pagePreviewHtml(page: Page): string {
  for (const card of page.cards) {
    if (card.pending) continue;
    for (const block of card.blocks) {
      if (block.type === "paragraph") {
        return `<b>${esc(page.title)}</b><div class="xprev">${depthText(block.text, card.level)}</div>`;
      }
      if (block.type === "html") {
        return `<b>${esc(page.title)}</b><div class="xprev">${block.html}</div>`;
      }
    }
  }
  return `<b>${esc(page.title)}</b>`;
}

const ANCHOR_SELECTOR =
  "[data-refs], [data-threads], a.cx[data-node], [data-cprev], [data-cjump]";

export function HoverPopover() {
  const [html, setHtml] = useState<string | null>(null);
  const anchorRef = useRef<Element | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const overAnchor = useRef<Element | null>(null);
  const scrollQuiet = useRef(false);
  const htmlRef = useRef<string | null>(null);
  htmlRef.current = html;
  const navigate = useNavigate();
  const { id: reviewId } = useParams<{ id: string }>();

  const hide = (): void => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    overAnchor.current = null;
    anchorRef.current = null;
    setHtml(null);
  };
  const hideRef = useRef(hide);
  hideRef.current = hide;

  const openFor = (anchor: Element): void => {
    const snap = useReview.getState().snapshot;
    if (!snap) return;
    let content = "";
    if (anchor instanceof HTMLElement && anchor.dataset.refs) {
      const targets = anchor.dataset.refs.split("|");
      const resolved = resolveBlockCitations(
        snap,
        targets.map((target) => ({ target })),
      );
      content = resolved
        .map(
          (c) =>
            `<button class="cite" data-src="${esc(c.target)}"><span class="loc">${esc(c.label)}${c.unverified ? " · unverified" : ""}</span><span class="snip">${esc(c.snippet)}</span></button>`,
        )
        .join("");
    } else if (anchor instanceof HTMLElement && anchor.dataset.threads) {
      const ids = anchor.dataset.threads.split("|");
      content =
        ids
          .map((id) => previewThread(snap.annotations.find((a) => a.id === id)))
          .join("") + `<span class="hint">Click to open</span>`;
    } else if (anchor instanceof HTMLElement && (anchor.dataset.cprev || anchor.dataset.cjump)) {
      const id = anchor.dataset.cprev ?? anchor.dataset.cjump ?? "";
      content =
        previewThread(snap.annotations.find((a) => a.id === id)) +
        `<span class="hint">Click to go to it in the diff</span>`;
    } else if (anchor.matches("a.cx[data-node]")) {
      const page = snap.pages.find((p) => p.id === (anchor as HTMLAnchorElement).dataset.node);
      if (!page) return;
      content = `${pagePreviewHtml(page)}<span class="hint">Click to open</span>`;
    }
    if (!content) return;
    anchorRef.current = anchor;
    setHtml(content);
  };
  const openForRef = useRef(openFor);
  openForRef.current = openFor;

  // Position after render, flipping above the anchor near the viewport edge.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef.current;
    if (!html || !pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    pop.style.top = `${top}px`;
  }, [html]);

  useEffect(() => {
    const clear = (): void => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (e.movementX || e.movementY) scrollQuiet.current = false;
    };

    const onMouseOver = (e: MouseEvent): void => {
      if (scrollQuiet.current) return;
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("#pop")) {
        clear();
        return;
      }
      const anchor = target.closest(ANCHOR_SELECTOR);
      clear();
      overAnchor.current = anchor;
      if (anchor) {
        if (anchor !== anchorRef.current) {
          const pending = anchor;
          openTimer.current = window.setTimeout(() => {
            if (scrollQuiet.current || !pending.isConnected || overAnchor.current !== pending) return;
            openForRef.current(pending);
          }, OPEN_DELAY_MS);
        }
      } else if (anchorRef.current) {
        closeTimer.current = window.setTimeout(() => hideRef.current(), CLOSE_DELAY_MS);
      }
    };

    const dismissOnScroll = (e: Event): void => {
      if ((e.target as Element | null)?.closest?.("#pop")) return;
      scrollQuiet.current = true;
      hideRef.current();
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.("#pop")) hideRef.current();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") hideRef.current();
    };

    const onMouseLeave = (): void => {
      hideRef.current();
    };

    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("scroll", dismissOnScroll, true);
    document.addEventListener("wheel", dismissOnScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("blur", hideRef.current);
    window.addEventListener("resize", hideRef.current);
    return () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("scroll", dismissOnScroll, true);
      document.removeEventListener("wheel", dismissOnScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("blur", hideRef.current);
      window.removeEventListener("resize", hideRef.current);
      clear();
    };
  }, []);

  return (
    <div
      id="pop"
      ref={popRef}
      hidden={html === null}
      onClick={(e) => {
        const target = e.target as Element;
        const src = target.closest?.("[data-src]");
        if (src) {
          revealSource(src.getAttribute("data-src") ?? "");
          hideRef.current();
          return;
        }
        const link = target.closest?.("a.cx[data-node]");
        if (link) {
          e.preventDefault();
          const pageId = link.getAttribute("data-node") ?? "";
          const snap = useReview.getState().snapshot;
          const page = snap?.pages.find((p) => p.id === pageId);
          navigate(
            page?.kind === "root" || pageId === "root"
              ? `/review/${reviewId}`
              : `/review/${reviewId}/page/${encodeURIComponent(pageId)}`,
          );
          hideRef.current();
        }
      }}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}
