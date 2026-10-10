/**
 * Comment thread (comments owner; PRD §4.8, §4.15).
 *
 * Prototype class names kept (`ithread`, `thd`, `mq`, `msg`, `av`, `who`,
 * `composer`) so `styles/prototype.css` applies unchanged.
 *
 * - Header: quoted text (or `file:line` in the diff), Mark for PR (send
 *   icon, filled when on), Delete, Close.
 * - Reply box always visible with Discard and Reply; typed text survives
 *   any re-render elsewhere (local state keyed by thread id, debounced
 *   through `PATCH …/comments/:id` `reply`); Discard removes a new empty
 *   thread and clears the box on an existing one; Cmd/Ctrl+Enter sends.
 * - Ask threads show the agent as working until its reply arrives through
 *   a patch; Note threads never do. Agent-suggested first messages render
 *   as "Agent · suggested comment" and start unmarked for the PR.
 * - Outdated threads show the original snippet + a link to the new code.
 * - Posted threads show their posted state and are never pending.
 */
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "@unvibe/shared";
import { api } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tick = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function successsorTarget(thread: Annotation): string | null {
  const successor = thread.successor;
  if (!successor) return null;
  const host = successor.host;
  if (host.kind === "diff-line") {
    const range = host.endLine && host.endLine !== host.line ? `${host.line}-${host.endLine}` : `${host.line}`;
    return `diff:${host.fileKey}:${range}`;
  }
  if (host.kind === "description") return `desc:${host.paragraphId}`;
  return null;
}

function headerLabel(snapshotFile: string | null, thread: Annotation): string {
  if (thread.anchor.quotedText) return `“${thread.anchor.quotedText}”`;
  if (thread.anchor.host.kind === "diff-line") {
    const name = snapshotFile ?? thread.anchor.host.fileKey;
    return `${name}:${thread.anchor.host.line}`;
  }
  return "Comment";
}

interface Props {
  reviewId: string;
  thread: Annotation;
}

export function ThreadView({ reviewId, thread }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const host = thread.anchor.host;
  const file =
    host.kind === "diff-line"
      ? (snapshot?.files.find((f) => f.fileKey === host.fileKey)?.path.split("/").pop() ?? null)
      : null;
  const messages = thread.messages;
  const isNew = messages.length === 0;
  const last = messages[messages.length - 1];
  const working = !thread.note && messages.length > 0 && last?.who === "you";
  const posted = thread.postedAt !== undefined;
  const successor = successsorTarget(thread);

  const [draft, setDraft] = useState(thread.reply ?? "");
  const [sending, setSending] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const mountedId = useRef(thread.id);
  if (mountedId.current !== thread.id) {
    mountedId.current = thread.id;
    setDraft(thread.reply ?? "");
  }

  // Server-cleared boxes (after Reply) and external edits flow back in;
  // unrelated WS patches carry the same value and leave typing alone.
  // (Intentionally dep-only on the server value: `draft` is local state.)
  useEffect(() => {
    if (thread.reply !== undefined && thread.reply !== draft) {
      setDraft(thread.reply);
    }
  }, [thread.reply]);

  // Flush an unsent reply on unmount so debounced text is never lost.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const serverReplyRef = useRef(thread.reply);
  serverReplyRef.current = thread.reply;
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      const current = draftRef.current;
      if (current !== (serverReplyRef.current ?? "") && current.trim() !== "") {
        api.updateComment(reviewId, thread.id, { reply: current }).catch(() => {});
      }
    },
    [reviewId, thread.id],
  );

  const persistReply = (value: string): void => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.updateComment(reviewId, thread.id, { reply: value }).catch(() => {
        // Local draft stays; a toast on every keystroke would be noise.
      });
    }, 400);
  };

  const onDiscard = (): void => {
    window.clearTimeout(saveTimer.current);
    if (isNew && draft.trim() === "") {
      api.deleteComment(reviewId, thread.id).catch((err: unknown) => {
        toast(`Couldn't discard the comment: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    setDraft("");
    api.updateComment(reviewId, thread.id, { reply: null }).catch((err: unknown) => {
      toast(`Couldn't clear the reply: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const onSend = (): void => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    api
      .replyComment(reviewId, thread.id, { text })
      .then(() => setDraft(""))
      .catch((err: unknown) => {
        toast(`Couldn't send the reply: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setSending(false));
  };

  const togglePost = (): void => {
    api.updateComment(reviewId, thread.id, { post: !thread.post }).catch((err: unknown) => {
      toast(`Couldn't mark the comment: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const onDelete = (): void => {
    api.deleteComment(reviewId, thread.id).catch((err: unknown) => {
      toast(`Couldn't delete the comment: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const onClose = (): void => {
    api.updateComment(reviewId, thread.id, { open: false }).catch((err: unknown) => {
      toast(`Couldn't close the comment: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  return (
    <div className="ithread" id={thread.id} data-thread={thread.id}>
      <div className="thd">
        <span className="mq">{headerLabel(file, thread)}</span>
        {isNew ? null : (
          <button
            className="ib pr"
            type="button"
            data-tip={thread.post ? "Marked for the PR · click to unmark" : "Mark for the PR"}
            aria-label={thread.post ? "Marked for the PR · click to unmark" : "Mark for the PR"}
            aria-pressed={thread.post}
            data-post={thread.id}
            onClick={togglePost}
          >
            <Icon name="send" />
          </button>
        )}
        <button
          className="ib"
          type="button"
          data-tip="Delete"
          aria-label="Delete"
          data-remove={thread.id}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
        {isNew ? null : (
          <button
            className="ib"
            type="button"
            data-tip="Close"
            aria-label="Close"
            data-closethr={thread.id}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
      {thread.outdated ? (
        <div className="pv outdated">
          <div className="q">Outdated · the code changed</div>
          {thread.originalSnippet ? (
            <div className="snip">{thread.originalSnippet.slice(0, 200)}</div>
          ) : null}
          {successor ? (
            <button className="cite" type="button" onClick={() => revealSource(successor)}>
              <span className="loc">See the new code →</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {messages.map((m, i) => (
        <div className="msg" key={i}>
          <span className={`av ${m.who === "you" ? "you" : "ai"}`}>{m.who === "you" ? "Me" : "AI"}</span>
          <div>
            <div className="who">{m.who === "you" ? "You" : m.suggested ? "Agent · suggested comment" : "Agent"}</div>
            <p dangerouslySetInnerHTML={{ __html: m.html ?? tick(m.text ?? "") }} />
          </div>
        </div>
      ))}
      {working ? (
        <div className="working" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Reading the diff and PR body…</span>
        </div>
      ) : null}
      {posted ? (
        <div className="hint">
          Posted
          {thread.postedUrl ? (
            <>
              {" · "}
              <a href={thread.postedUrl} target="_blank" rel="noreferrer">
                view on GitHub
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="composer">
        <textarea
          id={`ta-${thread.id}`}
          rows={isNew ? 3 : 1}
          placeholder={isNew ? (thread.note ? "Write a note…" : "Ask the agent, or draft a review comment…") : "Reply…"}
          aria-label={isNew ? "New comment" : "Reply"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            persistReply(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="row">
          <button
            className="btn ghost"
            type="button"
            data-discard={thread.id}
            data-tip={isNew ? "Discard this comment" : "Clear the reply"}
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            className="btn"
            type="button"
            data-send={thread.id}
            disabled={sending || draft.trim() === ""}
            onClick={onSend}
          >
            {thread.note ? "Save" : isNew ? "Ask" : "Reply"}
          </button>
        </div>
      </div>
    </div>
  );
}
