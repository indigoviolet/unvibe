/**
 * New-thread composer (comments owner).
 *
 * The pending box the selection toolbar and diff line clicks open *before*
 * anything reaches the server: Discard removes it locally (no request).
 * Notes save through `POST …/comments` and stay quiet; Ask sends the
 * `ask` action (thread + agent reply in one round trip) and the thread
 * then shows a plain working state until its reply arrives through a
 * patch (or an error with a Retry button when the turn fails). While the
 * request is in flight the composer itself shows the Ask as running.
 */
import { useRef, useState } from "react";
import type { ActionAnchor, Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { performAction } from "../guide/actions.js";
import { useReview } from "../state/store.js";
import { markAskSent } from "./askState.js";

interface Props {
  reviewId: string;
  anchor: ActionAnchor;
  quote: string;
  /** True = Note (no agent reply); false = Ask. */
  note: boolean;
  onDiscard: () => void;
  onCreated: (id: string) => void;
}

export function NewThreadComposer({ reviewId, anchor, quote, note, onDiscard, onCreated }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Set once the question/note is sent: thread ids already here, so only
  // a thread created after the send hides the composer.
  const [sent, setSent] = useState(false);
  const knownRef = useRef<ReadonlySet<string> | null>(null);
  const annotations = useReview((s) => s.snapshot?.annotations);

  // The service creates the thread at once: it lands by patch before the
  // ask/note response returns (issue #97). Hide the composer as soon as
  // its thread exists, so the question never shows twice; the thread
  // carries the working state. The component stays mounted (typed text
  // preserved) until the response settles it through onCreated.
  if (sent) {
    const known = knownRef.current ?? new Set<string>();
    const created = (annotations ?? []).some(
      (a) => a.type === "thread" && a.open && !known.has(a.id) && threadAnchorMatches(anchor, a),
    );
    if (created) return null;
  }

  const send = (): void => {
    const value = text.trim();
    if (!value || sending) return;
    knownRef.current = new Set(
      (useReview.getState().snapshot?.annotations ?? [])
        .filter((a) => a.type === "thread" && threadAnchorMatches(anchor, a))
        .map((a) => a.id),
    );
    setSent(true);
    setSending(true);
    if (!note) {
      performAction(reviewId, { kind: "ask", anchor, quote, message: value }, { toast: false })
        .then((res) => {
          const id = res.threadId ?? res.annotationId;
          if (!id) throw new Error("the service didn't create the comment — try again");
          markAskSent(id);
          onCreated(id);
        })
        .catch((err: unknown) => {
          toast(`Couldn't ask the agent: ${friendlyError(err)}`);
        })
        .finally(() => setSending(false));
      return;
    }
    api
      .createComment(reviewId, { anchor, quote, note, text: value })
      .then((res) => {
        onCreated(res.id);
      })
      .catch((err: unknown) => {
        toast(`Couldn't create the comment: ${friendlyError(err)}`);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="ithread" data-pending-thread="true" aria-busy={sending && !note ? true : undefined}>
      <div className="thd">
        <span className="mq">{quote ? `“${quote}”` : "New comment"}</span>
      </div>
      {sending && !note ? (
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
          placeholder={note ? "Write a note…" : "Ask the agent, or draft a review comment…"}
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
            {note ? "Save" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Same-anchor check for a composer and a thread (issue #97): the composer
 * anchor names the thread host exactly or by its bare block id (a
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
  return false;
}

function bare(blockId: string): string {
  const hash = blockId.indexOf("#");
  return hash >= 0 ? blockId.slice(hash + 1) : blockId;
}
