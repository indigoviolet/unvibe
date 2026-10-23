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
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useNavigate, useParams } from "react-router";
import type { Anchor, Annotation, Page } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import { PERSON_SVG_INNER, SPARK_SVG_INNER } from "../components/Icon.js";
import { api } from "../api/client.js";
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

/** Source target for an anchor successor (outdated "new code" link). */
function successorTarget(successor: Anchor): string | null {
  const host = successor.host;
  if (host.kind === "diff-line") {
    const range = host.endLine && host.endLine !== host.line ? `${host.line}-${host.endLine}` : `${host.line}`;
    return `diff:${host.fileKey}:${range}`;
  }
  if (host.kind === "code") {
    const range = host.endLine && host.endLine !== host.line ? `${host.line}-${host.endLine}` : `${host.line}`;
    return `code:${host.path}:${range}@${host.commit}`;
  }
  if (host.kind === "description") return `desc:${host.paragraphId}`;
  return null;
}

function previewThread(thread: Annotation | undefined, openable = false): string {
  if (!thread) return "";
  const inner = previewThreadInner(thread);
  // Issue #205: each item of a comment marker's preview opens just its
  // own comment (the marker itself opens them all).
  return openable
    ? `<button class="pv-item" type="button" data-open-thread="${esc(thread.id)}">${inner}</button>`
    : inner;
}

function previewThreadInner(thread: Annotation): string {
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
      const renderCites = (list: typeof resolved): string =>
        list
          .map(
            (c) =>
              `<button class="cite" data-src="${esc(c.target)}"><span class="loc">${esc(c.label)}${c.unverified ? " · unverified" : ""}</span><span class="snip">${esc(c.snippet)}</span></button>`,
          )
          .join("");
      content = renderCites(resolved);
      // #81: cited lines of a file outside the diff have no hunk rows —
      // fetch them at the cited commit and fill the preview in place.
      const missing = resolved.filter((c) => c.snippet === "" && c.target.startsWith("code:"));
      if (missing.length > 0 && reviewId) {
        const anchorEl = anchor;
        void Promise.all(
          missing.map(async (c) => {
            const parsed = parseId(c.target);
            if (!parsed || parsed.kind !== "code") return null;
            try {
              const slice = await api.fileSlice(reviewId, {
                path: parsed.path,
                commit: parsed.sha ?? snap.version.headSha,
                start: parsed.start,
                end: Math.min(parsed.end, parsed.start + 3),
              });
              return { target: c.target, snippet: slice.lines.join("\n") };
            } catch (err) {
              // Past-the-end range: the 400 carries the file end — retry
              // clamped to whatever part of the range exists (#81).
              const m = err instanceof Error ? err.message.match(/"totalLines":\s*(\d+)/) : null;
              const total = m ? Number(m[1]) : 0;
              if (total <= 0 || parsed.start > total) return null;
              try {
                const slice = await api.fileSlice(reviewId, {
                  path: parsed.path,
                  commit: parsed.sha ?? snap.version.headSha,
                  start: parsed.start,
                  end: total,
                });
                return { target: c.target, snippet: slice.lines.join("\n") };
              } catch {
                return null;
              }
            }
          }),
        ).then((fills) => {
          if (anchorRef.current !== anchorEl) return;
          const byTarget = new Map(fills.filter((f) => f !== null).map((f) => [f.target, f.snippet]));
          if (byTarget.size === 0) return;
          setHtml(
            renderCites(
              resolved.map((c) => {
                const snippet = byTarget.get(c.target);
                return snippet !== undefined ? { ...c, snippet } : c;
              }),
            ),
          );
        });
      }
    } else if (ds.threads) {
      const ids = ds.threads.split("|");
      content =
        ids
          .map((id) => previewThread(snap.annotations.find((a) => a.id === id), true))
          .join("") + `<span class="hint">Click an item to open it, or the marker to open all</span>`;
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
          // Issue #204: the peek is floating only; clicking it (or the
          // mark) pins the card in place.
          content =
            `<button class="pv-item" type="button" data-open-expansion="${esc(found.id)}">` +
            previewExpansion(found) +
            `<span class="hint">Click to pin here</span></button>`;
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
        const preview = previewLinkTarget(target, snap.pages, anchor.textContent ?? undefined);
        content = preview ?? "";
      }
    }
    if (!content) return;
    anchorRef.current = anchor;
    setHtml(content);
  };
  const openForRef = useRef(openFor);
  openForRef.current = openFor;

  // Position after render with Floating UI (#218): below the anchor,
  // flipping above near the viewport edge and shifting inside it.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef.current;
    if (!html || !pop || !anchor) return;
    let live = true;
    void computePosition(anchor, pop, {
      placement: "bottom",
      middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (!live || anchorRef.current !== anchor || popRef.current !== pop) return;
      // Final clamp (as the hand-rolled code had): an anchor partly past
      // the viewport edge still lands the whole popover inside it.
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, x))}px`;
      pop.style.top = `${Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, y))}px`;
    });
    return () => {
      live = false;
    };
  }, [html]);

  useEffect(() => {
    const clear = (): void => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };

    // Last known cursor position, and whether the pointer genuinely moved
    // after the current scroll began (see the settle check in dismissOnScroll).
    const lastMouse = { x: -1, y: -1, movedAt: 0 };
    let scrollBeganAt = 0;
    let lastScrollAt = 0;
    let settleTimer: number | undefined;
    // Anchor a real mouseover claimed before a scroll ate its open.
    let scrollWanted: Element | null = null;

    const scheduleOpen = (anchor: Element): void => {
      overAnchor.current = anchor;
      const pending = anchor;
      openTimer.current = window.setTimeout(() => {
        if (!pending.isConnected) {
          // The anchor re-rendered under a stationary pointer while
          // the open was pending (a snapshot patch replaced the node):
          // re-resolve the anchor under the cursor and try once more,
          // or the hover is lost until the pointer moves again.
          const target = document.elementFromPoint(lastMouse.x, lastMouse.y);
          const again = target?.closest?.(ANCHOR_SELECTOR);
          if (again && again !== pending) scheduleOpen(again);
          return;
        }
        if (scrollQuiet.current || overAnchor.current !== pending) return;
        openForRef.current(pending);
      }, OPEN_DELAY_MS);
    };

    const onPointerMove = (e: PointerEvent): void => {
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      if (!(e.movementX || e.movementY)) return;
      lastMouse.movedAt = Date.now();
      const wasQuiet = scrollQuiet.current;
      scrollQuiet.current = false;
      // A scroll can land an anchor under a stationary cursor: its
      // mouseover fired (and was ignored) during the scroll, and moving
      // within the anchor never refires it. On the first real movement
      // after the scroll, treat the anchor under the cursor as hovered.
      if (wasQuiet && !anchorRef.current) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const anchor = target?.closest?.(ANCHOR_SELECTOR);
        if (anchor) scheduleOpen(anchor);
      }
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
        if (anchor !== anchorRef.current) scheduleOpen(anchor);
      } else if (anchorRef.current) {
        closeTimer.current = window.setTimeout(() => hideRef.current(), CLOSE_DELAY_MS);
      }
    };

    const dismissOnScroll = (e: Event): void => {
      if ((e.target as Element | null)?.closest?.("#pop")) return;
      // Trailing scroll events of one sequence (separated by the pointer
      // move that ends it) still belong to that sequence: only a scroll
      // after a quiet gap starts a new sequence.
      const now = Date.now();
      if (now - lastScrollAt > 600) scrollBeganAt = now;
      lastScrollAt = now;
      scrollQuiet.current = true;
      if (overAnchor.current) scrollWanted = overAnchor.current;
      hideRef.current();
      // A trailing scroll event can land after the pointer has already
      // moved onto an anchor (its mouseover was ignored above, and the
      // scheduled open is cancelled by the hide). Once scrolling settles,
      // re-check the anchor under the cursor — but only when the pointer
      // genuinely moved after this scroll began, so content sliding under
      // a stationary cursor still never opens.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        scrollQuiet.current = false;
        if (anchorRef.current) return;
        // A pointer that genuinely moved after the scroll began, or
        // one a real (non-scroll) mouseover already claimed as
        // hovering an anchor whose scheduled open this scroll ate:
        // either proves a deliberate hover, so re-arm it. Content
        // sliding under a stationary cursor sets neither.
        const wanted = scrollWanted;
        scrollWanted = null;
        if (lastMouse.movedAt < scrollBeganAt && !wanted?.isConnected) return;
        const target = document.elementFromPoint(lastMouse.x, lastMouse.y);
        const anchor = target?.closest?.(ANCHOR_SELECTOR);
        if (anchor) scheduleOpen(anchor);
      }, 350);
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
      window.clearTimeout(settleTimer);
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
        // Issue #205: a preview item opens just its own comment.
        const openThread = target.closest?.("[data-open-thread]");
        if (openThread && reviewId) {
          const id = (openThread as HTMLElement).dataset.openThread ?? "";
          if (id) {
            api.updateComment(reviewId, id, { open: true }).catch(() => {});
            hideRef.current();
            window.setTimeout(() => {
              document.getElementById(id)?.scrollIntoView({ block: "nearest" });
            }, 120);
          }
          return;
        }
        // Issue #204: clicking the peek pins the card in place.
        const openExp = target.closest?.("[data-open-expansion]");
        if (openExp && reviewId) {
          const id = (openExp as HTMLElement).dataset.openExpansion ?? "";
          if (id) {
            api.updateComment(reviewId, id, { open: true, pinned: true }).catch(() => {});
            hideRef.current();
            window.setTimeout(() => {
              document.getElementById(`B-${id}`)?.scrollIntoView({ block: "nearest" });
            }, 120);
          }
          return;
        }
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
