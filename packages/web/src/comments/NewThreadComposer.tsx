/**
 * Pending composer (comments owner).
 *
 * The box the selection toolbar and diff line clicks open *before*
 * anything reaches the server: Discard removes it locally (no request).
 * A comment saves through `POST …/comments` (for the PR by default) and
 * stays quiet; Ask sends the `ask` action, which creates the usual
 * conversation card in place — the card then shows a plain working state
 * until its first answer arrives through a patch. While the request is in
 * flight the composer itself shows the Ask as running.
 */
import { useRef, useState } from "react";
import type { ActionAnchor, Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { performAction } from "../guide/actions.js";
import { useReview } from "../state/store.js";

interface Props {
  reviewId: string;
  anchor: ActionAnchor;
  quote: string;
  /** Comment (no agent reply) or Ask (usual conversation card). */
  kind: "comment" | "ask";
  /** Prefilled text (issue #135: a Comment from an agent answer quotes the selection). */
  initialText?: string;
  /** Issue #166: the selection's offsets within its host's text, when recorded. */
  offsets?: { start: number; end: number };
  onDiscard: () => void;
  onCreated: (id: string) => void;
}

export function NewThreadComposer({ reviewId, anchor, quote, kind, initialText, offsets, onDiscard, onCreated }: Props) {
  const [text, setText] = useState(initialText ?? "");
  const [sending, setSending] = useState(false);
  // Set once the question/comment is sent: annotation ids already here, so
  // only one created after the send hides the composer.
  const [sent, setSent] = useState(false);
  const knownRef = useRef<ReadonlySet<string> | null>(null);
  const annotations = useReview((s) => s.snapshot?.annotations);
  const ask = kind === "ask";

  // The service creates the annotation at once: it lands by patch before
  // the ask/comment response returns (issue #97). Hide the composer as
  // soon as its annotation exists, so the question never shows twice; the
  // card carries the working state. The component stays mounted (typed
  // text preserved) until the response settles it through onCreated.
  if (sent) {
    const known = knownRef.current ?? new Set<string>();
    const created = (annotations ?? []).some(
      (a) => a.open && !known.has(a.id) && threadAnchorMatches(anchor, a),
    );
    if (created) return null;
  }

  const send = (): void => {
    const value = text.trim();
    if (!value || sending) return;
    knownRef.current = new Set(
      (useReview.getState().snapshot?.annotations ?? [])
        .filter((a) => threadAnchorMatches(anchor, a))
        .map((a) => a.id),
    );
    setSent(true);
    setSending(true);
    if (ask) {
      performAction(
        reviewId,
        {
          kind: "ask",
          anchor,
          quote,
          message: value,
          ...(offsets ? { offsets } : {}),
        },
        { toast: false },
      )
        .then((res) => {
          const id = res.annotationId;
          if (!id) throw new Error("the service didn't create the card — try again");
          onCreated(id);
        })
        .catch((err: unknown) => {
          toast(`Couldn't ask the agent: ${friendlyError(err)}`);
        })
        .finally(() => setSending(false));
      return;
    }
    api
      .createComment(reviewId, {
        anchor,
        quote,
        text: value,
        ...(offsets ? { offsets } : {}),
      })
      .then((res) => {
        onCreated(res.id);
      })
      .catch((err: unknown) => {
        toast(`Couldn't create the comment: ${friendlyError(err)}`);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="ithread" data-pending-thread="true" aria-busy={sending && ask ? true : undefined}>
      <div className="thd">
        <span className="mq">{quote ? `“${quote}”` : "New comment"}</span>
      </div>
      {sending && ask ? (
        <div className="working" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Asking…</span>
        </div>
      ) : null}
      <div className="composer">
        <textarea
          rows={3}
          autoFocus
          placeholder={ask ? "Ask the agent…" : "Write a comment…"}
          aria-label="New comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row">
          <button className="btn ghost" type="button" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn" type="button" disabled={sending || text.trim() === ""} onClick={send}>
            {ask ? "Ask" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Same-anchor check for a composer and an annotation (issue #97): the
 * composer anchor names the host exactly or by its bare block id (a
 * selection carries the bare id while the service qualifies it
 * `card#block`). A differently-qualified anchor never matches, so
 * composers on same-named blocks of other cards stay independent.
 * Description and diff-line anchors match exactly.
 */
function threadAnchorMatches(anchor: ActionAnchor, thread: Annotation): boolean {
  const host = thread.anchor.host;
  if (anchor.where === "block" && host.kind === "block") {
    return anchor.blockId === host.blockId || anchor.blockId === bare(host.blockId);
  }
  if (anchor.where === "description" && host.kind === "description") {
    return anchor.paragraphId === host.paragraphId;
  }
  if (anchor.where === "diff-line" && host.kind === "diff-line") {
    return anchor.fileKey === host.fileKey && anchor.line === host.line;
  }
  if (anchor.where === "hunk" && host.kind === "hunk") {
    return anchor.fileKey === host.fileKey && anchor.contentHash === host.contentHash;
  }
  return false;
}

function bare(blockId: string): string {
  const hash = blockId.indexOf("#");
  return hash >= 0 ? blockId.slice(hash + 1) : blockId;
}
