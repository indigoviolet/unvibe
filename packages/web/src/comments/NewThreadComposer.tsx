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
import { useState } from "react";
import type { ActionAnchor } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { performAction } from "../guide/actions.js";
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

  const send = (): void => {
    const value = text.trim();
    if (!value || sending) return;
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
