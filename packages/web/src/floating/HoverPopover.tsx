/**
 * Hover popover (web-guide owner; PRD §4.5).
 *
 * Dotted page links preview title + first paragraph (click opens the page);
 * `<>` citation markers preview the cited lines (click reveals the source);
 * comment markers and suggested-comment links preview the thread, including
 * the outdated banner (original snippet + link to the new code) when the
 * anchor moved.
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
import type { Anchor, Annotation, Page } from "@unvibe/shared";
import { PERSON_SVG_INNER, SPARK_SVG_INNER } from "../components/Icon.js";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { resolveBlockCitations } from "../guide/citations.js";
import { lookupConceptPage, pagePreviewHtml } from "../guide/guideUtils.js";
import { openLinkTarget, previewLinkTarget } from "../guide/RichText.js";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 220;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tick = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function renderMsgs(msgs: Annotation["messages"]): string {
  // Author avatars are icons, not text (owner decision): a person icon
  // for the reviewer, the spark for the agent. Shapes come from
  // `components/Icon.tsx`. Screen-reader names follow the #45 glossary
  // ("You" / "Agent").
  return msgs
    .map((m) => {
      const you = m.who === "you";
      const av = you ? "you" : "ai";
      const name = you ? "You" : "Agent";
      const inner = you ? PERSON_SVG_INNER : SPARK_SVG_INNER;
      return `<div class="msg"><span class="av ${av}" role="img" aria-label="${name}" data-tip="${name}"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${inner}</svg></span><div><p>${tick(m.text ?? "")}</p></div></div>`;
    })
    .join("");
}

/** `diff:` target for an anchor successor (outdated "new code" link). */
function successorTarget(successor: Anchor): string | null {
  const host = successor.host;
  if (host.kind === "diff-line") {
    const range = host.endLine && host.endLine !== host.line ? `${host.line}-${host.endLine}` : `${host.line}`;
    return `diff:${host.fileKey}:${range}`;
  }
  if (host.kind === "description") return `desc:${host.paragraphId}`;
  return null;
}

function previewThread(thread: Annotation | undefined): string {
  if (!thread) return "";
  const outdated = thread.outdated
    ? `<div class="pv outdated"><div class="q">Outdated · the code changed</div>` +
      (thread.originalSnippet
        ? `<div class="snip">${esc(thread.originalSnippet).slice(0, 200)}</div>`
        : "") +
      (thread.successor && successorTarget(thread.successor)
        ? `<button class="cite" data-src="${esc(successorTarget(thread.successor) as string)}"><span class="loc">See the new code →</span></button>`
        : "") +
      `</div>`
    : "";
  return (
    outdated +
    `<div class="pv">${thread.anchor.quotedText ? `<div class="q">“${esc(thread.anchor.quotedText)}”</div>` : ""}${renderMsgs(thread.messages.slice(0, 2))}${thread.messages.length > 2 ? `<span class="hint">+${thread.messages.length - 2} more</span>` : ""}</div>`
  );
}

function pagePreview(page: Page): string {
  const html = pagePreviewHtml(page);
  return `<b>${esc(page.title)}</b>${html ? `<div class="xprev">${html}</div>` : ""}`;
}

/** Closed conversation-card preview: quoted text + first paragraph (PRD §4.7). */
function previewExpansion(expansion: Annotation | undefined): string {
  if (!expansion) return "";
  const firstTurn = (expansion.turns ?? [])[0];
  const blocks = firstTurn?.blocks ?? [];
  const level = firstTurn?.level ?? "standard";
  let first = "";
  for (const b of blocks) {
    if (b.type === "paragraph") {
      const html =
        level === "simple" ? (b.text.simple ?? b.text.standard) : level === "deep" ? (b.text.deep ?? b.text.standard) : b.text.standard;
      if (html.trim()) {
        first = html;
        break;
      }
    }
  }
  const working = expansion.working ?? firstTurn?.working;
  const body = first
    ? `<div class="xprev">${first}</div>`
    : working
      ? `<span class="hint">${esc(working)}</span>`
      : `<span class="hint">Writing explanation…</span>`;
  return `<b>“${esc(expansion.anchor.quotedText)}”</b>${body}`;
}

const ANCHOR_SELECTOR =
  "[data-refs], [data-threads], a.cx[data-node], a.cx[data-link], [data-cprev], [data-cjump], mark.anc[data-jump]";

export function HoverPopover() {
  const [html, setHtml] = useState<string | null>(null);
  const anchorRef = useRef<Element | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const overAnchor = useRef<Element | null>(null);
  const scrollQuiet = useRef(false);
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
    const byId = new Map(snap.pages.map((p) => [p.id, p]));
    const lookup = (id: string): Page | undefined => byId.get(id);
    // `dataset` lives on HTMLElement and SVGElement alike (diagram anchors
    // are SVG `<a>` elements); never narrow to `instanceof HTMLElement`.
    const ds = (anchor as HTMLElement).dataset;
    let content = "";
    if (ds.refs) {
      const targets = ds.refs.split("|");
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
    } else if (ds.threads) {
      const ids = ds.threads.split("|");
      content =
        ids
          .map((id) => previewThread(snap.annotations.find((a) => a.id === id)))
          .join("") + `<span class="hint">Click to open</span>`;
    } else if (ds.cprev || ds.cjump) {
      const id = ds.cprev ?? ds.cjump ?? "";
      content =
        previewThread(snap.annotations.find((a) => a.id === id)) +
        `<span class="hint">Click to go to it in the diff</span>`;
    } else if (ds.jump) {
      const id = ds.jump;
      const found = snap.annotations.find((a) => a.id === id);
      if (found && (found.type === "conversation" || found.type === "link")) {
        if (found.promotedToPage) {
          const page = lookup(found.promotedToPage);
          content = page
            ? `${pagePreview(page)}<span class="hint">Click to open</span>`
            : `<b>${esc(found.anchor.quotedText)}</b><span class="hint">Click to open</span>`;
        } else {
          content = previewExpansion(found) + `<span class="hint">Click to open here</span>`;
        }
      }
    } else if (anchor.matches("a.cx[data-node], a.cx[data-link]")) {
      const target =
        (anchor as HTMLAnchorElement).dataset.link ??
        (anchor as HTMLAnchorElement).dataset.node ??
        "";
      let page: Page | undefined;
      if (target.startsWith("page:")) page = lookup(target.slice(5));
      else if (target.startsWith("concept:")) page = lookupConceptPage(lookup, target.slice(8));
      else page = lookup(target);
      if (page) {
        content = `${pagePreview(page)}<span class="hint">Click to open</span>`;
      } else {
        const preview = previewLinkTarget(target, snap.pages);
        content = preview ?? "";
      }
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
        const link = target.closest?.("a.cx[data-node], a.cx[data-link]");
        if (link) {
          e.preventDefault();
          const t =
            (link as HTMLElement).dataset.link ?? (link as HTMLElement).dataset.node ?? "";
          openLinkTarget(t, useReview.getState().snapshot?.pages, (pageId) => {
            const snap = useReview.getState().snapshot;
            const page = snap?.pages.find((p) => p.id === pageId);
            navigate(
              page?.kind === "root"
                ? `/review/${reviewId}`
                : `/review/${reviewId}/page/${encodeURIComponent(pageId)}`,
            );
          });
          hideRef.current();
        }
      }}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}
