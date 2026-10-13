/**
 * Text-selection toolbar (comments owner; PRD §4.6).
 *
 * Ported from `prototype.html` (behaviour + `#selbar` styles, not code):
 * - works in the guide, the PR description and diff code;
 * - the selection snaps to whole words with leading/trailing spaces
 *   trimmed, and the highlight updates to match;
 * - offers Explain, Ask… and Comment;
 * - appears only when the user finishes selecting text, never after
 *   clicking a control;
 * - dismisses on scroll, outside press, Escape, blur, resize and selection
 *   collapse — the same rules as the other floating UI.
 *
 * Explain calls the `explain` action (accepted by the service; the
 * expansion card itself renders in a later milestone — never a break).
 * Ask… / Comment open a pending thread
 * composer at the anchor via the `unvibe:new-thread` event; the host
 * (guide block, description paragraph, diff line) renders it. Selection in
 * a pure-deletion diff row anchors to the nearest row with a new-side
 * line, as the prototype does.
 *
 * A Comment from a selection inside an agent answer (a conversation card,
 * issue #135) anchors where the card is anchored — not on the selected
 * block — and quotes the selection as a Markdown blockquote prefilled in
 * the composer, so it reads correctly once submitted to GitHub.
 *
 * GitHub (issue #134) is a plain link out: on a diff selection it opens
 * the selected lines in GitHub's file view at the review's commit (head
 * for added/unchanged lines, base for removed-only selections). It creates
 * no job and no pending thread, and stays hidden where there is nothing
 * unambiguous to open (prose, non-GitHub repos, the demo).
 *
 * The host-resolution + line-id helpers are re-exported for the
 * interaction agent's Explain/expansion cards (`resolveSelectionHost`).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ActionAnchor, ReviewSnapshot } from "@unvibe/shared";
import { githubFileUrl } from "@unvibe/shared";
import { api, apiErrorCode, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { isReadOnlyVersionNow, useIsReadOnlyVersion } from "../comments/readOnly.js";
import { parseLineElementId, snapWordOffsets, normalizeQuote, validSelectionQuote } from "../comments/selection.js";
import { performAction } from "../guide/actions.js";
import { NO_AGENT_COPY } from "../guide/expansions/expansionUtils.js";
import { showGuidePane } from "../shell/panes.js";
import { hunkCommentAnchor, hunkDiffRange, parseHunkAttr, promotedPageForHunk } from "../source/diff/hunkAnchor.js";
import { toast } from "./Toast.js";
import { useReview } from "../state/store.js";

export const NEW_THREAD_EVENT = "unvibe:new-thread";

export interface NewThreadRequest {
  anchor: ActionAnchor;
  quote: string;
  /** Comment (no agent reply) or Ask (usual conversation card). */
  kind: "comment" | "ask";
  /** Prefilled composer text (a Comment from an agent answer quotes the selection). */
  initialText?: string;
}

/** Ask a host to open a pending thread composer for this selection. */
export function requestNewThread(req: NewThreadRequest): void {
  window.dispatchEvent(new CustomEvent<NewThreadRequest>(NEW_THREAD_EVENT, { detail: req }));
}

export interface SelectionHost {
  anchor: ActionAnchor;
}

function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node.nodeType === 1) return node as HTMLElement;
  return (node.parentElement as HTMLElement | null) ?? null;
}

/**
 * True when the element sits in revealed context around a hunk (issue
 * #133): the anchor stays a diff line, but Comment is not offered there
 * (it could never land on the diff's own lines). Kept separate from
 * `resolveSelectionHost` so host shapes stay untouched.
 */
export function isRevealedElement(el: HTMLElement): boolean {
  return el.closest("tr[data-revealed]") !== null;
}

/**
 * Resolve a selection anchor element to an `ActionAnchor`. Exported for
 * reuse (Explain cards resolve the same hosts).
 */
export function resolveSelectionHost(el: HTMLElement): SelectionHost | null {
  // Second-opinion reasoning is attached content, not a host (#116): its
  // blocks live on the result, not on any card or answer, so the
  // service has no block to anchor to. No toolbar there.
  if (el.closest("[data-so]")) return null;
  // Issue #136: inside a conversation answer the owning unit is the
  // answer, found from the answer wrapper's attribute — not from
  // `section.card[id]`, which names the whole card.
  const answer = el.closest("[data-answer]");
  if (answer) {
    const answerId = (answer as HTMLElement).dataset.answer ?? "";
    const top = el.closest("[data-top]");
    const blockId = (top as HTMLElement | null)?.dataset.top ?? "";
    if (!answerId || !blockId) return null;
    return { anchor: { where: "block", blockId: `${answerId}#${blockId}` } };
  }
  const top = el.closest("#page [data-top], #right [data-top]");
  if (top) {
    const id = (top as HTMLElement).dataset.top ?? "";
    if (!id) return null;
    // Inside the description pane a `data-top` (or any `id`) addresses a
    // paragraph; in the guide it addresses a block.
    if (top.closest("#right .desc")) {
      const paragraphId = (top as HTMLElement).dataset.top ?? top.id ?? id;
      return { anchor: { where: "description", paragraphId } };
    }
    // Block ids repeat across cards (`b1`, `b2`, … in each): qualify with
    // the owning card, or conversation card, so the anchor addresses one
    // block. (Selections inside an answer return earlier, qualified with
    // the answer id.)
    const owner = top.closest("section.card[id]")?.id ?? "";
    const cardId = /^[CB]-/.test(owner) ? owner.slice(2) : "";
    return { anchor: { where: "block", blockId: cardId && !id.includes("#") ? `${cardId}#${id}` : id } };
  }
  // Description paragraphs carry stable `id`s but no `data-top` in live
  // snapshots: fall back to the nearest id under `.desc`.
  const descNode = el.closest("#right .desc [id]");
  if (descNode && el.closest("#right .desc")) {
    return { anchor: { where: "description", paragraphId: (descNode as HTMLElement).id } };
  }
  // Issue #138: an idle hunk summary is plain text with a `data-hunksum`
  // attribute — no component, no listener per hunk. Selecting in it still
  // brings up the toolbar, anchored on the hunk. (Selections inside an
  // activated card resolve to its answer blocks via the branches above.
  // The sticky hunk header's `data-hunk` is a different attribute and
  // never matches here.)
  const hunkEl = el.closest("[data-hunksum]") as HTMLElement | null;
  if (hunkEl) {
    const ref = parseHunkAttr(hunkEl.dataset.hunksum);
    if (ref) return { anchor: { where: "hunk", fileKey: ref.fileKey, contentHash: ref.contentHash } };
    return null;
  }
  const td = el.closest("#right table.diff td.c");
  if (!td) return null;
  // Rows without a new-side line number (pure deletions) anchor to the
  // nearest numbered row: forward first, then backward (prototype rule).
  const tr = td.closest("tr");
  let row: Element | null | undefined = tr;
  while (row && !(row.id?.startsWith("L-"))) row = row.nextElementSibling;
  if (!row) {
    row = tr;
    while (row && !(row.id?.startsWith("L-"))) row = row.previousElementSibling;
  }
  if (!row?.id) return null;
  const parsed = parseLineElementId(row.id);
  if (!parsed) return null;
  return { anchor: { where: "diff-line", fileKey: parsed.fileKey, line: parsed.line } };
}

/** Snap the live selection to whole words (single-range fast path). */
function snapLiveSelection(sel: Selection): void {
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
  // Multi-node ranges: only adjust when an end sits in a text node.
  try {
    if (sc === ec && sc.nodeType === 3) {
      const text = (sc as Text).data;
      const [nso, neo] = snapWordOffsets(text, so, eo);
      if (nso === so && neo === eo) return;
      range.setStart(sc, nso);
      range.setEnd(ec, neo);
      if (range.collapsed) return;
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    const clone = range.cloneRange();
    if (sc.nodeType === 3) {
      const text = (sc as Text).data;
      const [nso] = snapWordOffsets(text, so, text.length);
      clone.setStart(sc, nso);
    }
    if (ec.nodeType === 3) {
      const text = (ec as Text).data;
      const [, neo] = snapWordOffsets(text, 0, eo);
      clone.setEnd(ec, neo);
    }
    if (clone.collapsed) return;
    sel.removeAllRanges();
    sel.addRange(clone);
  } catch {
    // A range that refuses to snap keeps its original highlight.
  }
}

interface Pending {
  quote: string;
  anchor: ActionAnchor;
  /**
   * Issue #133: true when the selection sits in revealed context around
   * a hunk. Explain, Ask and GitHub stay; Comment hides (it could never
   * land on the diff's own lines).
   */
  revealed: boolean;
  /**
   * Issue #135: when the selection sits inside an expansion (an agent
   * answer), a Comment anchors where the card is anchored instead of on
   * the selected block. Absent for every other host.
   */
  commentAnchor?: ActionAnchor;
  /**
   * Issue #134: diff rows the selection touches, for the GitHub link.
   * Absent outside the diff (prose has no lines to open).
   */
  diffRange?: DiffRange;
}

/**
 * Diff lines behind a selection (issue #134): the file plus the touched
 * new-side lines and/or old-side (removed) lines. A selection spanning
 * files has none — there is nothing unambiguous to open.
 */
export interface DiffRange {
  fileKey: string;
  newLines: number[];
  oldLines: number[];
}

/**
 * Read the diff rows a selection touches. Rows with an id (`L-<fileKey>-<line>`)
 * carry a new-side line; id-less deleted rows carry the old-side line in
 * their first number cell. Null when the selection spans files or touches
 * no code row.
 */
export function diffRangeForSelection(sel: Selection): DiffRange | null {
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const rows = document.querySelectorAll("#right table.diff tr");
  let fileKey: string | null = null;
  const newLines: number[] = [];
  const oldLines: number[] = [];
  for (const row of rows) {
    let intersects = false;
    try {
      intersects = range.intersectsNode(row);
    } catch {
      continue;
    }
    if (!intersects) continue;
    const id = (row as HTMLElement).id ?? "";
    if (id.startsWith("L-")) {
      const parsed = parseLineElementId(id);
      if (!parsed) continue;
      if (fileKey === null) fileKey = parsed.fileKey;
      if (parsed.fileKey !== fileKey) return null;
      newLines.push(parsed.line);
      continue;
    }
    // Id-less rows are pure deletions — or revealed context on a deleted
    // file's old side (issue #133, `data-revealed`, likewise id-less):
    // the old-side line sits in the first number cell.
    if (!(row as HTMLElement).className.includes("del") && (row as HTMLElement).dataset.revealed !== "1") continue;
    const section = (row as HTMLElement).closest("[id^='F-']");
    const sectionKey = section ? (section as HTMLElement).id.slice(2) : "";
    if (!sectionKey) continue;
    if (fileKey === null) fileKey = sectionKey;
    if (sectionKey !== fileKey) return null;
    const num = (row as HTMLElement).querySelector("td.n")?.textContent?.trim() ?? "";
    const line = Number(num);
    if (Number.isSafeInteger(line) && line >= 1) oldLines.push(line);
  }
  if (fileKey === null || (newLines.length === 0 && oldLines.length === 0)) return null;
  return { fileKey, newLines, oldLines };
}

/**
 * GitHub file-view URL for a diff selection (issue #134): the review head
 * commit with new-side lines, or the base commit with old-side lines when
 * the selection is only on removed lines. The commits are the version's
 * own, so older versions link their own SHAs. Null when anything needed
 * is unknown.
 */
export function githubHrefForRange(
  snapshot: ReviewSnapshot | null | undefined,
  repo: { owner: string; name: string } | null,
  diffRange: DiffRange,
): string | null {
  if (!snapshot || !repo) return null;
  const file = snapshot.files.find((f) => f.fileKey === diffRange.fileKey);
  if (!file) return null;
  const removedOnly = diffRange.newLines.length === 0;
  const lines = removedOnly ? diffRange.oldLines : diffRange.newLines;
  if (lines.length === 0) return null;
  const sha = removedOnly ? snapshot.version.mergeBaseSha : snapshot.version.headSha;
  if (!sha) return null;
  const start = Math.min(...lines);
  const end = Math.max(...lines);
  return githubFileUrl(repo.owner, repo.name, sha, file.path, start, end === start ? undefined : end);
}

/** Quote a selection as a Markdown blockquote, so it reads on GitHub. */
export function blockquoteQuote(quote: string): string {
  const lines = quote.split("\n").map((l) => `> ${l}`.trimEnd());
  return `${lines.join("\n")}\n\n`;
}

/**
 * Card anchor behind a block anchor that sits inside a conversation
 * answer (issue #135): the owner part of `<answer>#<block>` names the
 * answer, whose card's own anchor is where a Comment from its text
 * belongs. Null for page-card anchors and anything unresolvable.
 * Issue #138: an answer on a hunk card comments on the hunk's first
 * changed line (never the hunk — comments live on lines).
 */
export function commentCardAnchor(anchor: ActionAnchor): ActionAnchor | null {
  if (anchor.where !== "block") return null;
  const hash = anchor.blockId.indexOf("#");
  if (hash < 0) return null;
  const owner = anchor.blockId.slice(0, hash);
  const annotations = useReview.getState().snapshot?.annotations ?? [];
  const found =
    annotations.find((a) => a.id === owner) ??
    annotations.find((a) => (a.turns ?? []).some((t) => t.id === owner));
  if (!found || found.type !== "conversation") return null;
  const host = found.anchor.host;
  if (host.kind === "block") return { where: "block", blockId: host.blockId };
  if (host.kind === "description") return { where: "description", paragraphId: host.paragraphId };
  if (host.kind === "hunk") {
    return (
      hunkCommentAnchor(useReview.getState().snapshot, { fileKey: host.fileKey, contentHash: host.contentHash }) ??
      null
    );
  }
  return { where: "diff-line", fileKey: host.fileKey, line: host.line };
}

export function SelectionToolbar() {
  const [pending, setPending] = useState<Pending | null>(null);
  const readOnly = useIsReadOnlyVersion();
  const snapshot = useReview((s) => s.snapshot);
  const navigate = useNavigate();
  const barRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  // Issue #134: the repo behind this review (owner/name for the GitHub
  // link). Local checkouts (`owner: "local"`), the demo and unknown repos
  // have no GitHub file view, so the action hides there.
  const [githubRepo, setGithubRepo] = useState<{ owner: string; name: string } | null>(null);
  useEffect(() => {
    const repoId = snapshot?.review.repoId;
    if (!repoId || repoId === "demo") {
      setGithubRepo(null);
      return;
    }
    let cancelled = false;
    api
      .repos()
      .then((r) => {
        if (cancelled) return;
        const found = r.repos.find((x) => x.id === repoId);
        setGithubRepo(found && found.owner !== "local" ? { owner: found.owner, name: found.name } : null);
      })
      .catch(() => {
        if (!cancelled) setGithubRepo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot?.review.repoId]);

  useEffect(() => {
    const bar = (): HTMLElement | null => barRef.current;
    const hide = (): void => setPending(null);

    const onMouseUp = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest?.("#selbar")) return;
      const scope = (e.target as Element | null)?.closest?.(
        "#page, #right .desc:not(.editing), #right table.diff, #right .dhunk .fwrap",
      );
      if (
        !scope ||
        (e.target as Element | null)?.closest?.("button, a, input, textarea") ||
        isReadOnlyVersionNow()
      ) {
        hide();
        return;
      }
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          hide();
          return;
        }
        snapLiveSelection(sel);
        const quote = normalizeQuote(sel.toString());
        const anchorNode = sel.anchorNode;
        const host = resolveSelectionHost(elementOf(anchorNode) ?? document.body);
        if (!quote || !validSelectionQuote(quote) || !host) {
          hide();
          return;
        }
        const cardAnchor = commentCardAnchor(host.anchor);
        // Issue #138: a hunk anchor needs the touched rows mapped from
        // the hunk itself (the summary is no table row): Comment lands on
        // the hunk's first changed line without activating the summary,
        // and GitHub opens the hunk's line range.
        let hunkComment: ActionAnchor | undefined;
        let hunkRange: DiffRange | undefined;
        if (host.anchor.where === "hunk") {
          const snap = useReview.getState().snapshot;
          const ref = { fileKey: host.anchor.fileKey, contentHash: host.anchor.contentHash };
          hunkComment = hunkCommentAnchor(snap, ref) ?? undefined;
          hunkRange = hunkDiffRange(snap, ref) ?? undefined;
        }
        // The GitHub link needs the touched rows, not just the anchor
        // line — but only on the anchor's own file (a cross-file drag has
        // nothing unambiguous to open).
        let diffRange: DiffRange | undefined;
        if (host.anchor.where === "diff-line") {
          const touched = diffRangeForSelection(sel);
          if (touched && touched.fileKey === host.anchor.fileKey) diffRange = touched;
        }
        setPending({
          quote,
          anchor: host.anchor,
          revealed: isRevealedElement(elementOf(anchorNode) ?? document.body),
          ...(cardAnchor ? { commentAnchor: cardAnchor } : {}),
          ...(hunkComment ? { commentAnchor: hunkComment } : {}),
          ...(diffRange ? { diffRange } : {}),
          ...(hunkRange ? { diffRange: hunkRange } : {}),
        });
        // Position after render (needs the bar's size).
        window.setTimeout(() => {
          const b = bar();
          if (!b || sel.rangeCount === 0) return;
          const r = sel.getRangeAt(0).getBoundingClientRect();
          b.style.left = `${Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, r.left + r.width / 2 - b.offsetWidth / 2))}px`;
          const preferBelow = r.top - b.offsetHeight - 8 < 56;
          const rawTop = preferBelow ? r.bottom + 8 : r.top - b.offsetHeight - 8;
          b.style.top = `${Math.max(8, Math.min(window.innerHeight - b.offsetHeight - 8, rawTop))}px`;
        }, 0);
      }, 0);
    };

    const onSelectionChange = (): void => {
      if (window.getSelection()?.isCollapsed) hide();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") hide();
    };
    const onScroll = (): void => hide();
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.("#selbar")) hide();
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("wheel", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  const dismiss = (): void => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  /**
   * Page a hunk-anchored action belongs to when the hunk's discussion
   * already moved there (issue #138 follow-up): Explain/Ask open the
   * page instead of activating a fresh card. Null otherwise (the action
   * runs normally, activating the summary first).
   */
  const promotedTarget = (anchor: ActionAnchor): { pageId: string; reviewId: string } | null => {
    if (anchor.where !== "hunk") return null;
    const snap = useReview.getState().snapshot;
    const pageId = promotedPageForHunk(snap, { fileKey: anchor.fileKey, contentHash: anchor.contentHash });
    const reviewId = snap?.review.id;
    if (!pageId || !reviewId) return null;
    if (!snap?.pages.some((p) => p.id === pageId)) return null;
    return { pageId, reviewId };
  };

  const openPromotedPage = (target: { pageId: string; reviewId: string }): void => {
    dismiss();
    showGuidePane();
    navigate(`/review/${target.reviewId}/page/${encodeURIComponent(target.pageId)}`);
  };

  const onExplain = (): void => {
    const current = pendingRef.current;
    if (!current) return;
    const promoted = promotedTarget(current.anchor);
    if (promoted) {
      openPromotedPage(promoted);
      return;
    }
    const reviewId = useReview.getState().snapshot?.review.id;
    dismiss();
    if (!reviewId) {
      toast("The review is still loading");
      return;
    }
    // The in-flight entry (keyed by anchor) is set synchronously, so a
    // placeholder shows where the explanation will land before the
    // request returns.
    performAction(
      reviewId,
      { kind: "explain", quote: current.quote, anchor: current.anchor },
      { toast: false },
    )
      .then((res) => {
        if (!res.accepted) toast("Not available with mock data");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (apiErrorCode(err) === "no-agent" || /no agent configured/i.test(msg)) {
          toast(NO_AGENT_COPY);
        } else {
          toast(`Couldn't explain: ${friendlyError(err)}`);
        }
      });
  };

  const onAskNote = (kind: "comment" | "ask"): void => {
    const current = pendingRef.current;
    if (!current) return;
    if (kind === "ask") {
      const promoted = promotedTarget(current.anchor);
      if (promoted) {
        openPromotedPage(promoted);
        return;
      }
    }
    dismiss();
    if (kind === "comment" && current.commentAnchor) {
      requestNewThread({
        anchor: current.commentAnchor,
        quote: current.quote,
        kind,
        initialText: blockquoteQuote(current.quote),
      });
      return;
    }
    requestNewThread({ anchor: current.anchor, quote: current.quote, kind });
  };

  return (
    <div id="selbar" ref={barRef} hidden={pending === null || readOnly}>
      <button type="button" data-act="explain" onClick={onExplain}>
        Explain
      </button>
      <span className="sep" />
      <button type="button" data-act="ask" onClick={() => onAskNote("ask")}>
        Ask…
      </button>
      {pending?.revealed ? null : (
        <button type="button" data-act="note" onClick={() => onAskNote("comment")}>
          Comment
        </button>
      )}
      {pending?.diffRange ? (
        <GithubAction snapshot={snapshot} repo={githubRepo} diffRange={pending.diffRange} onOpen={dismiss} />
      ) : null}
    </div>
  );
}

/**
 * Issue #134: plain link out to the selected lines on GitHub. Renders
 * nothing where there is nothing unambiguous to open (no repo, no file,
 * no commit). No job, no pending thread — clicking only dismisses the bar.
 */
function GithubAction({
  snapshot,
  repo,
  diffRange,
  onOpen,
}: {
  snapshot: ReviewSnapshot | null | undefined;
  repo: { owner: string; name: string } | null;
  diffRange: DiffRange;
  onOpen: () => void;
}): React.JSX.Element | null {
  const href = githubHrefForRange(snapshot, repo, diffRange);
  if (!href) return null;
  return (
    <>
      <span className="sep" />
      <a
        data-act="github"
        href={href}
        target="_blank"
        rel="noreferrer"
        data-tip="Open these lines on GitHub"
        aria-label="Open these lines on GitHub"
        onClick={onOpen}
      >
        <Icon name="open" />
        GitHub
      </a>
    </>
  );
}
