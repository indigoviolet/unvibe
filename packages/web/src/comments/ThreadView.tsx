/**
 * Comment thread (comments owner; PRD §4.8, §4.15).
 *
 * Prototype class names kept (`ithread`, `thd`, `mq`, `msg`, `av`, `who`,
 * `composer`) so `styles/prototype.css` applies unchanged.
 *
 * - Header: quoted text (or `file:line` in the diff), Mark for PR (send
 *   icon, filled when on), "Ask the agent about this" (opens the usual
 *   Ask card on the comment's anchor, quoting the comment — the only way
 *   a comment leads to an agent reply), Delete, Close.
 * - Reply box always visible with Discard and Reply/Save; typed text
 *   survives any re-render elsewhere (the shared `ReplyBox`, debounced
 *   through `PATCH …/comments/:id` `reply`). Discard removes a new
 *   comment and clears the box on an existing one; Cmd/Ctrl+Enter sends.
 *   Replies are reviewer-written only — never agent answers.
 * - Outdated comments show the original snippet + a link to the new code.
 * - Posted comments show their posted state and are never pending.
 */
import type { ActionAnchor, Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { performAction } from "../guide/actions.js";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { ReplyBox } from "./ReplyBox.js";
import { threadPostText } from "./threads.js";

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

/** The comment's own anchor as an action anchor (for ask-about). */
function commentActionAnchor(thread: Annotation): ActionAnchor {
  const host = thread.anchor.host;
  if (host.kind === "block") return { where: "block", blockId: host.blockId };
  if (host.kind === "description") return { where: "description", paragraphId: host.paragraphId };
  return { where: "diff-line", fileKey: host.fileKey, line: host.line };
}

interface Props {
  reviewId: string;
  thread: Annotation;
  /** Older versions render read-only: no composer, actions disabled. */
  readOnly?: boolean;
}

export function ThreadView({ reviewId, thread, readOnly }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const host = thread.anchor.host;
  const file =
    host.kind === "diff-line"
      ? (snapshot?.files.find((f) => f.fileKey === host.fileKey)?.path.split("/").pop() ?? null)
      : null;
  const messages = thread.messages;
  const isNew = messages.length === 0;
  const posted = thread.postedAt !== undefined;
  const successor = successsorTarget(thread);

  const onAskAbout = (): void => {
    // The only way a comment leads to an agent reply: the usual Ask card
    // on the comment's anchor, quoting the comment. The answer is never
    // submitted; only the reviewer's own comments go to the PR.
    const text = threadPostText(thread).trim();
    if (!text) {
      toast("Write the comment first, then ask about it");
      return;
    }
    void performAction(
      reviewId,
      { kind: "ask", quote: text, anchor: commentActionAnchor(thread), message: text },
      { toast: false },
    ).catch((err: unknown) => {
      toast(`Couldn't ask the agent: ${friendlyError(err)}`);
    });
  };

  const togglePost = (): void => {
    api.updateComment(reviewId, thread.id, { post: !thread.post }).catch((err: unknown) => {
      toast(`Couldn't mark the comment: ${friendlyError(err)}`);
    });
  };

  const onDelete = (): void => {
    api.deleteComment(reviewId, thread.id).catch((err: unknown) => {
      toast(`Couldn't delete the comment: ${friendlyError(err)}`);
    });
  };

  const onClose = (): void => {
    api.updateComment(reviewId, thread.id, { open: false }).catch((err: unknown) => {
      toast(`Couldn't close the comment: ${friendlyError(err)}`);
    });
  };

  const footnoted = !!thread.anchorStale;
  return (
    <div className="ithread" id={thread.id} data-thread={thread.id}>
      <div className="thd">
        <span className="mq">{headerLabel(file, thread)}</span>
        {footnoted ? <span className="hint">from an earlier wording</span> : null}
        {!isNew ? (
          <button
            className="ib pr"
            type="button"
            data-tip={
              readOnly
                ? "Viewing an older version · read-only"
                : thread.post
                  ? "Marked for the PR · click to unmark"
                  : "Mark for the PR"
            }
            aria-label={thread.post ? "Marked for the PR · click to unmark" : "Mark for the PR"}
            aria-pressed={thread.post}
            data-post={thread.id}
            disabled={readOnly}
            onClick={togglePost}
          >
            <Icon name="send" />
          </button>
        ) : null}
        {!isNew && !readOnly ? (
          <button
            className="ib"
            type="button"
            data-tip="Ask the agent about this"
            aria-label="Ask the agent about this"
            data-ask-about={thread.id}
            onClick={onAskAbout}
          >
            <Icon name="spark" />
          </button>
        ) : null}
        <button
          className="ib"
          type="button"
          data-tip={readOnly ? "Viewing an older version · read-only" : "Delete"}
          aria-label="Delete"
          data-remove={thread.id}
          disabled={readOnly}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
        {isNew ? null : (
          <button
            className="ib"
            type="button"
            data-tip={readOnly ? "Viewing an older version · read-only" : "Close"}
            aria-label="Close"
            data-closethr={thread.id}
            disabled={readOnly}
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
          <span
            className={`av ${m.who === "you" ? "you" : "ai"}`}
            role="img"
            aria-label={m.who === "you" ? "You" : "Agent"}
            data-tip={m.who === "you" ? "You" : "Agent"}
          >
            <Icon name={m.who === "you" ? "person" : "spark"} />
          </span>
          <div>
            <p dangerouslySetInnerHTML={{ __html: tick(m.text ?? "") }} />
          </div>
        </div>
      ))}
      {posted ? (
        <div className="hint">
          Posted
          {thread.postedUrl ? (
            <>
              {" · "}
              <a href={thread.postedUrl} target="_blank" rel="noreferrer noopener">
                view on GitHub
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {readOnly ? (
        <div className="hint">Viewing an older version · read-only</div>
      ) : (
        <ReplyBox
          reviewId={reviewId}
          annotationId={thread.id}
          serverReply={thread.reply}
          placeholder={isNew ? "Write a comment…" : "Reply…"}
          ariaLabel={isNew ? "New comment" : "Reply"}
          sendLabel={isNew ? "Save" : "Reply"}
          discardLabel="Discard"
          rows={isNew ? 3 : 1}
          allowEmptyDiscard={isNew}
          onSend={(text) => api.replyComment(reviewId, thread.id, { text })}
          onDiscard={() =>
            isNew
              ? api.deleteComment(reviewId, thread.id)
              : api.updateComment(reviewId, thread.id, { reply: null })
          }
        />
      )}
    </div>
  );
}
