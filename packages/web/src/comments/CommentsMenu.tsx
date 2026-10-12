/**
 * Comments menu (comments owner; PRD §4.8).
 *
 * Prototype behaviour + classes (`.cmenu`, `.ci`, `.cj`, `.cw`, `.cx2`,
 * `.prtag`), not code:
 * - lists every comment from the guide, the description and the diff with
 *   its location; clicking one jumps to it (opening the thread, switching
 *   page/tab, unfolding/unhiding as needed);
 * - the For PR filter shows the comments marked for the PR, each with an
 *   editable draft of the text to post (saved through `PATCH …/comments`,
 *   debounced, never lost on re-render);
 * - counts on the button; it never posts.
 * - Existing PR comments already on GitHub (`existingComments`) render
 *   read-only under a separate heading.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Annotation, ExistingReviewComment, ReviewSnapshot } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { anchorMatchesBlock } from "../guide/guideUtils.js";
import { requestGuideBlock } from "../guide/actions.js";
import { REVEAL_EVENT } from "../source/diff/revealSource.js";
import { revealSource } from "../source/reveal.js";
import { showGuidePane } from "../shell/panes.js";
import { useReview } from "../state/store.js";
import { useIsReadOnlyVersion } from "./readOnly.js";
import { threadPostText } from "./threads.js";

const plain = (s: string): string => s.replace(/<[^>]+>/g, "");

function excerpt(thread: Annotation): string {
  const first = thread.messages[0];
  return plain(first?.text ?? first?.html ?? "").slice(0, 140);
}

function resolveFilePath(snapshot: ReviewSnapshot, key: string): string | null {
  // Snapshots store canonical file keys (no alias map).
  return snapshot.files.find((f) => f.fileKey === key)?.path ?? null;
}

function shortDiffLabel(snapshot: ReviewSnapshot, target: string): string | null {
  const parsed = parseId(target);
  if (!parsed || parsed.kind !== "diff") return null;
  const path = resolveFilePath(snapshot, parsed.fileKey);
  const name = path?.split("/").pop() ?? parsed.fileKey;
  return parsed.start === parsed.end ? `${name}:${parsed.start}` : `${name}:${parsed.start}`;
}

function findBlockCitations(snapshot: ReviewSnapshot, blockId: string): string[] {
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const block of card.blocks ?? []) {
        const b = block as { id?: string; citations?: { target: string }[] };
        if (b.id === blockId) return (b.citations ?? []).map((c) => c.target);
      }
    }
  }
  return [];
}

/** Where GitHub will show the thread (client approximation; Submit shows the backend preview). */
export function prLocationLabel(snapshot: ReviewSnapshot, thread: Annotation): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot.files.find((f) => f.fileKey === host.fileKey);
    const name = file?.path.split("/").pop() ?? host.fileKey;
    return `${name}:${host.line}`;
  }
  if (host.kind === "block") {
    const hash = host.blockId.indexOf("#");
    const bare = hash >= 0 ? host.blockId.slice(hash + 1) : host.blockId;
    for (const candidate of [host.blockId, bare]) {
      const first = findBlockCitations(snapshot, candidate).find((t) => t.startsWith("diff:"));
      if (first) {
        const label = shortDiffLabel(snapshot, first);
        if (label) return label;
      }
    }
    return "General PR comment";
  }
  return "General PR comment";
}

/** "From …" origin for menu rows. */
export function whereLabel(snapshot: ReviewSnapshot, thread: Annotation): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot.files.find((f) => f.fileKey === host.fileKey);
    return file?.path ?? host.fileKey;
  }
  if (host.kind === "description") return "PR description";
  for (const page of snapshot.pages) {
    for (const card of page.cards) {
      for (const block of card.blocks) {
        const b = block as { id?: string };
        if (b.id && anchorMatchesBlock(host.kind === "block" ? host.blockId : "", card.id, b.id)) {
          const title = page.title.length > 34 ? `${page.title.slice(0, 33)}…` : page.title;
          return card.title ? `${title} › ${card.title}` : title;
        }
      }
    }
  }
  return "Guide";
}

/** Draft textarea: local state survives re-renders; saves debounce to the server. */
function DraftArea({
  reviewId,
  thread,
  readOnly,
}: {
  reviewId: string;
  thread: Annotation;
  readOnly: boolean;
}) {
  const serverDraft = thread.draft ?? threadPostText(thread);
  const [value, setValue] = useState(serverDraft);
  const timer = useRef<number | undefined>(undefined);

  // Resync only when the server value actually changes: unrelated WS
  // patches keep the same draft string, so typing is never overwritten.
  useEffect(() => {
    if (thread.draft !== undefined) setValue(thread.draft);
  }, [thread.draft]);

  // Flush an unsaved draft on unmount (e.g. closing the menu): debounced
  // saves must never be lost on re-render or close.
  const valueRef = useRef(value);
  valueRef.current = value;
  const serverRef = useRef(thread.draft);
  serverRef.current = thread.draft;
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const current = valueRef.current;
      if (current !== serverRef.current) {
        api.updateComment(reviewId, thread.id, { draft: current }).catch(() => {});
      }
    },
    [reviewId, thread.id],
  );

  return (
    <textarea
      id={`ob-${thread.id}`}
      aria-label="Draft PR comment"
      value={value}
      readOnly={readOnly}
      title={readOnly ? "Viewing an older version · read-only" : undefined}
      onChange={(e) => {
        setValue(e.target.value);
        window.clearTimeout(timer.current);
        const next = e.target.value;
        timer.current = window.setTimeout(() => {
          api.updateComment(reviewId, thread.id, { draft: next }).catch((err: unknown) => {
            toast(`Couldn't save the draft: ${friendlyError(err)}`);
          });
        }, 400);
      }}
    />
  );
}

export function CommentsMenu({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  const readOnly = useIsReadOnlyVersion();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "pr">("all");
  const [fetchedExisting, setFetchedExisting] = useState<ExistingReviewComment[] | null>(null);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLSpanElement>(null);

  const threads = useMemo(
    () =>
      ((snapshot?.annotations ?? []).filter(
        (a) => a.type === "thread" && (a as Annotation).messages.length > 0,
      ) as Annotation[]),
    [snapshot],
  );
  const forPr = useMemo(() => threads.filter((t) => t.post), [threads]);
  const existing = snapshot?.existingComments ?? fetchedExisting ?? null;

  // Fetch read-only GitHub comments once per menu opening when the
  // snapshot doesn't carry them yet.
  useEffect(() => {
    if (!open || !snapshot || snapshot.existingComments) return;
    if (!snapshot.review.prNumber) return;
    api
      .prComments(reviewId)
      .then((res) => setFetchedExisting(res.comments))
      .catch(() => {});
  }, [open, snapshot, reviewId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open ]);

  const jump = (thread: Annotation): void => {
    const snap = useReview.getState().snapshot;
    if (!snap) return;
    setOpen(false);
    api.updateComment(reviewId, thread.id, { open: true }).catch(() => {});
    const host = thread.anchor.host;
    if (host.kind === "diff-line") {
      revealSource(`diff:${host.fileKey}:${host.line}`);
      window.setTimeout(() => {
        document.getElementById(thread.id)?.scrollIntoView({ block: "nearest" });
      }, 300);
      return;
    }
    if (host.kind === "description") {
      window.dispatchEvent(
        new CustomEvent(REVEAL_EVENT, { detail: { ref: `desc:${host.paragraphId}` } }),
      );
      window.setTimeout(() => {
        const el = document.getElementById(thread.id) ?? document.getElementById(host.paragraphId);
        el?.scrollIntoView({ block: "center" });
      }, 200);
      return;
    }
    // Guide thread: open its page, expand a collapsed card, scroll to it.
    // The menu now lives in the review bar, so jumping to a guide thread
    // while only the source pane is showing brings the guide back (#83).
    const holder = snap.pages
      .flatMap((p) => p.cards.map((c) => ({ page: p, card: c })))
      .find(({ card }) =>
        card.blocks.some((b) => anchorMatchesBlock(host.blockId, card.id, (b as { id: string }).id)),
      );
    if (!holder) return;
    const go = (): void => {
      showGuidePane();
      if (holder.card.collapsed) {
        api.action(reviewId, { kind: "collapse", cardId: holder.card.id, collapsed: false }).catch(() => {});
      }
      window.setTimeout(() => {
        const blockId = host.blockId.includes("#") ? host.blockId.split("#")[1] : host.blockId;
        requestGuideBlock(holder.card.id, blockId);
        window.setTimeout(() => {
          document.getElementById(thread.id)?.scrollIntoView({ block: "center" });
        }, 200);
      }, 120);
    };
    if (holder.page.kind === "root") navigate(`/review/${reviewId}`);
    else navigate(`/review/${reviewId}/page/${encodeURIComponent(holder.page.id)}`);
    go();
  };

  const list = filter === "pr" ? forPr : threads;

  return (
    <span ref={rootRef} style={{ position: "relative" }}>
      <button
        className="tbtn"
        type="button"
        data-cm=""
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="comment" />
        Comments {threads.length}
        {forPr.length > 0 ? <span className="count">{forPr.length} for PR</span> : null}
      </button>
      {open && snapshot ? (
        <div className="cmenu" role="dialog" aria-label="Comments">
          <div className="frow">
            <span className="seg">
              <button type="button" data-cmf="all" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All {threads.length}
              </button>
              <button type="button" data-cmf="pr" aria-pressed={filter === "pr"} onClick={() => setFilter("pr")}>
                For PR {forPr.length}
              </button>
            </span>
            <span className="sp" />
            <button className="ib" type="button" data-tip="Close" aria-label="Close" data-cmclose="" onClick={() => setOpen(false)}>
              <Icon name="x" />
            </button>
          </div>
          {list.map((thread) => {
            const where = whereLabel(snapshot, thread);
            return (
              <div className="ci" key={thread.id}>
                <button className="cj" type="button" data-cjump={thread.id} onClick={() => jump(thread)}>
                  <span className="cw">
                    {filter === "pr" ? `${prLocationLabel(snapshot, thread)} · from ${where}` : where}
                  </span>
                  <span className="cx2">{excerpt(thread)}</span>
                </button>
                {thread.post ? <span className="prtag">For PR</span> : null}
                {filter === "pr" ? <DraftArea reviewId={reviewId} thread={thread} readOnly={readOnly} /> : null}
              </div>
            );
          })}
          {list.length === 0 ? (
            <p className="hint" style={{ margin: 4 }}>
              {filter === "pr"
                ? "Nothing marked for the PR yet. Use “For PR” on any comment."
                : "No comments yet. Select text and choose Ask or Note."}
            </p>
          ) : null}
          {filter === "pr" && forPr.length > 0 ? (
            <span className="hint">These are drafts. Nothing reaches GitHub until you use Submit review.</span>
          ) : null}
          <div>
            <h3 className="hint" style={{ margin: "6px 0 2px" }}>
              Already on GitHub
            </h3>
            {existing === null ? (
              <p className="hint" style={{ margin: 4 }}>
                Loading existing comments…
              </p>
            ) : existing.length === 0 ? (
              <p className="hint" style={{ margin: 4 }}>
                No existing review comments.
              </p>
            ) : (
              existing.map((c) => (
                <div className="ci" key={`existing-${c.id}`}>
                  <span className="cj">
                    <span className="cw">
                      {c.path ?? "General"}
                      {c.line ? `:${c.line}` : ""} · {c.author ?? "GitHub"}
                    </span>
                    <span className="cx2">{c.body.slice(0, 140)}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}
