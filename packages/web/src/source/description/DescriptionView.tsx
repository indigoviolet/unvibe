/**
 * PR description tab (comments owner; PRD §4.11).
 *
 * - Description HTML with stable paragraph ids (`desc:` citation targets).
 *   For a branch without a PR the service renders commit messages
 *   (`source: "commits"`, read-only).
 * - Editing when the user authors an open PR (`description.editable`):
 *   in-place contenteditable body with Discard/Save; Save stores locally
 *   through `PUT …/description` and shows "Edited · goes to GitHub when
 *   you submit the review" with Revert edits. Edits keep paragraph ids so
 *   citations and annotations still resolve; while editing, the draft
 *   survives re-renders (it lives in a ref, not state).
 * - Threads sit under their paragraph (open ones render, closing leaves
 *   the highlight or a marker); selection in the description anchors to
 *   the paragraph id.
 * - "Restated →" links jump back to the guide block that restates the
 *   paragraph.
 *
 * The `editor` seam is kept: pass a custom `DescriptionEditor` to replace
 * the built-in contenteditable body.
 */
import type { MutableRefObject, ReactNode } from "react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { markTextInElement } from "../../comments/anchor.js";
import { NewThreadComposer } from "../../comments/NewThreadComposer.js";
import { ThreadView } from "../../comments/ThreadView.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../../floating/SelectionToolbar.js";
import { toast } from "../../floating/Toast.js";
import { Icon } from "../../components/Icon.js";
import { requestGuideBlock } from "../../guide/actions.js";
import { useReview } from "../../state/store.js";
import { cleanEditedHtml, DescriptionEditor as DefaultEditor } from "./DescriptionEditor.js";
import { splitDescriptionHtml } from "./segments.js";

export interface DescriptionEditor {
  render(params: { html: string; onSave: (html: string) => void; onDiscard: () => void }): ReactNode;
}

interface Props {
  reviewId: string;
  editor?: DescriptionEditor;
}

function innerOfDesc(html: string): string {
  return html
    .replace(/^[\s\S]*?<div class="desc"[^>]*>/i, "")
    .replace(/<\/div>\s*$/, "");
}

function wrapDesc(inner: string): string {
  return `<div class="desc">${inner}</div>`;
}

function makeMark(threadId: string): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "anc";
  mark.dataset.thr = threadId;
  return mark;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function DescriptionView({ reviewId, editor }: Props) {
  const description = useReview((s) => s.snapshot?.description);
  const annotations = useReview((s) => s.snapshot?.annotations);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<NewThreadRequest | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const draftRef = useRef("");

  const displayHtml = description?.pendingHtml ?? description?.html ?? "";
  const segments = useMemo(() => splitDescriptionHtml(displayHtml), [displayHtml]);
  const descThreads = useMemo(
    () =>
      (annotations ?? []).filter(
        (a): a is Annotation => a.type === "thread" && a.anchor.host.kind === "description",
      ),
    [annotations],
  );
  const byPara = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const thread of descThreads) {
      const pid = thread.anchor.host.kind === "description" ? thread.anchor.host.paragraphId : "";
      const list = map.get(pid) ?? [];
      list.push(thread);
      map.set(pid, list);
    }
    return map;
  }, [descThreads]);
  const knownIds = useMemo(
    () => new Set(segments.map((s) => s.id).filter((id): id is string => id !== null)),
    [segments],
  );
  const orphans = useMemo(
    () =>
      descThreads.filter((t) => {
        const pid = t.anchor.host.kind === "description" ? t.anchor.host.paragraphId : "";
        return !knownIds.has(pid);
      }),
    [descThreads, knownIds],
  );

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.anchor.where !== "description") return;
      setPending(req);
    };
    window.addEventListener(NEW_THREAD_EVENT, onRequest);
    return () => window.removeEventListener(NEW_THREAD_EVENT, onRequest);
  }, []);

  if (!description) {
    return (
      <div className="desc">
        <p className="hint">No description yet for review {reviewId}.</p>
      </div>
    );
  }

  const canEdit = description.editable && description.source === "pr";

  const startEditing = (): void => {
    draftRef.current = innerOfDesc(displayHtml);
    setEditing(true);
  };

  const saveEditing = (): void => {
    const cleaned = cleanEditedHtml(wrapDesc(draftRef.current));
    api
      .updateDescription(reviewId, { html: cleaned })
      .then(() => setEditing(false))
      .catch((err: unknown) => {
        toast(`Saving the description failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  const revertEdits = (): void => {
    api.revertDescription(reviewId).catch((err: unknown) => {
      toast(`Couldn't revert the description: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  return (
    <>
      {description.pendingHtml && !editing ? (
        <div className="dbar">
          <span className="hint">Edited · goes to GitHub when you submit the review</span>
          <span className="sp" />
          <button className="x" type="button" data-descrevert onClick={revertEdits}>
            Revert edits
          </button>
        </div>
      ) : null}
      {!canEdit && !editing ? (
        <div className="dbar">
          <span className="hint">
            {description.source === "commits"
              ? "Commit messages for a branch without a PR. The tab is read-only."
              : "You're reviewing someone else's PR, so the description is read-only."}
          </span>
          <span className="sp" />
        </div>
      ) : null}
      {canEdit && !editing ? (
        <div className="dbar">
          <span className="sp" />
          <button className="x" type="button" data-descedit onClick={startEditing}>
            Edit description
          </button>
        </div>
      ) : null}
      {editing ? (
        <>
          <div className="dbar">
            <span className="hint">Editing the description. Type directly in the text below.</span>
            <span className="sp" />
            <button className="btn ghost" type="button" data-descdiscard onClick={() => setEditing(false)}>
              Discard
            </button>
            <button className="btn" type="button" data-descsave onClick={saveEditing}>
              Save
            </button>
          </div>
          {editor ? (
            <div className="desc">
              {editor.render({
                html: displayHtml,
                onSave: (next) => {
                  api
                    .updateDescription(reviewId, { html: next })
                    .then(() => setEditing(false))
                    .catch((err: unknown) => {
                      toast(`Saving the description failed: ${err instanceof Error ? err.message : String(err)}`);
                    });
                },
                onDiscard: () => setEditing(false),
              })}
            </div>
          ) : (
            <DefaultEditor html={displayHtml} draftRef={draftRef} />
          )}
        </>
      ) : (
        <DescriptionBody
          reviewId={reviewId}
          segments={segments}
          byPara={byPara}
          orphans={orphans}
          highlighted={highlighted}
          setHighlighted={setHighlighted}
          pending={pending}
          setPending={setPending}
        />
      )}
    </>
  );
}

interface BodyProps {
  reviewId: string;
  segments: ReturnType<typeof splitDescriptionHtml>;
  byPara: Map<string, Annotation[]>;
  orphans: Annotation[];
  highlighted: ReadonlySet<string>;
  setHighlighted: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  pending: NewThreadRequest | null;
  setPending: (req: NewThreadRequest | null) => void;
}

const DescriptionBody = forwardRef<HTMLDivElement, BodyProps>(function DescriptionBody(
  { reviewId, segments, byPara, orphans, highlighted, setHighlighted, pending, setPending },
  ref,
) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Anchor highlights: wrap each thread quote inside its paragraph body.
  // Threads whose quote is gone (or empty) fall back to the marker.
  useEffect(() => {
    const root = innerRef.current;
    if (!root) return;
    const timer = window.setTimeout(() => {
      const found = new Set<string>();
      for (const [pid, threads] of byPara) {
        const body = root.querySelector(`[data-top="${CSS.escape(pid)}"] .dseg-body`);
        if (!body) continue;
        for (const thread of threads) {
          if (!thread.anchor.quotedText) continue;
          if (markTextInElement(body, thread.anchor.quotedText, () => makeMark(thread.id)) > 0) {
            found.add(thread.id);
          }
        }
      }
      setHighlighted((prev: ReadonlySet<string>) => (sameSet(prev, found) ? prev : found));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [byPara, segments, setHighlighted]);

  const openThread = (id: string): void => {
    api.updateComment(reviewId, id, { open: true }).catch((err: unknown) => {
      toast(`Couldn't open the comment: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const setRefs = (node: HTMLDivElement | null): void => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <div
      className="desc"
      ref={setRefs}
      onClick={(e) => {
        const mark = (e.target as HTMLElement).closest?.("mark.anc[data-thr]");
        if (mark) {
          openThread((mark as HTMLElement).dataset.thr ?? "");
          return;
        }
        const back = (e.target as HTMLElement).closest?.("button.back[data-back]");
        if (!back) return;
        const blockId = back.getAttribute("data-back") ?? "";
        const snap = useReview.getState().snapshot;
        const card = snap?.pages
          .flatMap((p) => p.cards)
          .find((c) => c.id === blockId || c.blocks.some((b) => b.id === blockId));
        if (card) requestGuideBlock(card.id, blockId);
      }}
    >
      {segments.map((seg, i) => {
        const threads = (seg.id && byPara.get(seg.id)) || [];
        const open = threads.filter((t) => t.open);
        const markers = threads.filter((t) => t.messages.length > 0 && !t.open && !highlighted.has(t.id));
        const showPending =
          pending && pending.anchor.where === "description" && pending.anchor.paragraphId === seg.id;
        return (
          <div key={seg.id ?? `seg-${i}`} data-top={seg.id ?? undefined}>
            <div className="dseg-body" dangerouslySetInnerHTML={{ __html: seg.html }} />
            {markers.length > 0 ? (
              <button
                className="lk cm"
                type="button"
                data-threads={markers.map((t) => t.id).join("|")}
                aria-label={`${markers.length} comments`}
                data-tip="Preview the comment thread"
                onClick={() => markers.forEach((t) => openThread(t.id))}
              >
                <Icon name="comment" />
                {markers.length}
              </button>
            ) : null}
            {open.map((t) => (
              <div className="dann" key={t.id}>
                <ThreadView reviewId={reviewId} thread={t} />
              </div>
            ))}
            {showPending && pending ? (
              <div className="dann">
                <NewThreadComposer
              key="pending"
                  reviewId={reviewId}
                  anchor={pending.anchor}
                  quote={pending.quote}
                  note={pending.note}
                  onDiscard={() => setPending(null)}
                  onCreated={() => setPending(null)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {orphans.filter((t) => t.open).length > 0 ? (
        <div className="dann">
          {orphans
            .filter((t) => t.open)
            .map((t) => (
              <ThreadView key={t.id} reviewId={reviewId} thread={t} />
            ))}
        </div>
      ) : null}
    </div>
  );
});
