/**
 * New-thread composer (comments owner).
 *
 * The pending box the selection toolbar and diff line clicks open *before*
 * anything reaches the server: Discard removes it locally (no request).
 * Notes save through `POST …/comments` and stay quiet; Ask sends the
 * `ask` action (thread + agent reply in one round trip) and the thread
 * then shows the agent as working until its reply arrives through a
 * patch (or an error with a Retry button when the turn fails).
 */
import { useState } from "react";
import type { ActionAnchor } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
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
      api
        .action(reviewId, { kind: "ask", anchor, quote, message: value })
        .then((res) => {
          const id = res.threadId ?? res.annotationId;
          if (!id) throw new Error("ask returned no thread");
          markAskSent(id);
          onCreated(id);
        })
        .catch((err: unknown) => {
          toast(`Couldn't ask the agent: ${err instanceof Error ? err.message : String(err)}`);
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
        toast(`Couldn't create the comment: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="ithread" data-pending-thread="true">
      <div className="thd">
        <span className="mq">{quote ? `“${quote}”` : "New comment"}</span>
      </div>
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
