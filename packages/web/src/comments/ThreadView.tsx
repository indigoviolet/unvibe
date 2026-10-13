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
 * - Ask threads show a plain working indicator until the reply arrives
 *   through a patch (fixed label, never streamed text); Note threads never
 *   do. A failed reply shows the error with a Retry button (the `retry`
 *   action rebuilds on the same thread). Agent-suggested first messages
 *   render as "Agent · suggested comment" and start unmarked for the PR.
 * - Outdated threads show the original snippet + a link to the new code.
 * - Posted threads show their posted state and are never pending.
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { performAction } from "../guide/actions.js";
import { busyForThread, inflightLabel } from "../guide/inflight.js";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { isAskWorking, markAskSent, useAskWorkingTick } from "./askState.js";

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

/**
 * End-of-message citation markers (PRD §4.5), mirroring the guide's
 * `BlockMarkers`: one `<>` button per verified group (count when >1),
 * one dimmed button per unverified citation; click reveals the source.
 */
function MessageCitations({ citations }: { citations: Annotation["messages"][number]["citations"] }): JSX.Element | null {
  const verified = (citations ?? []).filter((c) => !c.unverified);
  const unverified = (citations ?? []).filter((c) => c.unverified);
  if (verified.length === 0 && unverified.length === 0) return null;
  return (
    <span className="lo">
      {verified.length > 0 && (
        <button
          className="lk"
          type="button"
          data-refs={verified.map((c) => c.target).join("|")}
          data-src={verified[0].target}
          aria-label={verified.length > 1 ? `${verified.length} sources` : "Source"}
          data-tip="Show in source"
          onClick={() => revealSource(verified[0].target)}
        >
          <Icon name="code" />
          {verified.length > 1 ? verified.length : ""}
        </button>
      )}
      {unverified.map((c) => (
        <button
          key={c.target}
          className="lk unverified"
          type="button"
          data-refs={c.target}
          data-src={c.target}
          aria-label="Unverified source"
          data-tip="Unvibe couldn't confirm this points at the right code."
          onClick={() => revealSource(c.target)}
        >
          <Icon name="code" />
        </button>
      ))}
    </span>
  );
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
  const last = messages[messages.length - 1];
  const awaitingReply = !thread.note && messages.length > 0 && last?.who === "you";
  // The in-flight entry shows the moment the user sends (before the
  // request returns); the server's working flag and the live job take over
  // once they arrive. The 60 s client window stays as a fallback so a lost
  // patch never spins forever, then yields to a muted waiting note. The
  // label is always fixed — never streamed text. A failed turn sets
  // `thread.error` with a Retry button instead.
  const jobs = snapshot?.jobs ?? [];
  const inflight = useReview((s) => s.inflight);
  const busy = busyForThread(inflight, jobs, thread.id);
  const serverWorking = thread.working !== undefined && thread.working !== null && thread.working !== "";
  // A failed turn shows the error + Retry instead of any spinner.
  const working = awaitingReply && !thread.error && (!!busy || serverWorking || isAskWorking(thread.id));
  const waiting = awaitingReply && !working && !thread.error;
  useAskWorkingTick(thread.id, working);
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
        toast(`Couldn't discard the comment: ${friendlyError(err)}`);
      });
      return;
    }
    setDraft("");
    api.updateComment(reviewId, thread.id, { reply: null }).catch((err: unknown) => {
      toast(`Couldn't clear the reply: ${friendlyError(err)}`);
    });
  };

  const onSend = (): void => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ask = !thread.note;
    // Ask threads answer through the agent (`reply` action appends the
    // message and fills the reply); notes stay user-only. The reply path
    // sets its in-flight entry synchronously so the working state shows
    // on click, before the request returns.
    const send = ask
      ? performAction(reviewId, { kind: "reply", threadId: thread.id, message: text }, { toast: false })
      : api.replyComment(reviewId, thread.id, { text });
    send
      .then(() => {
        setDraft("");
        if (ask) markAskSent(thread.id);
      })
      .catch((err: unknown) => {
        toast(`Couldn't send the reply: ${friendlyError(err)}`);
      })
      .finally(() => setSending(false));
  };

  const onRetry = (): void => {
    if (sending) return;
    setSending(true);
    performAction(reviewId, { kind: "retry", threadId: thread.id }, { toast: false })
      .then(() => {
        markAskSent(thread.id);
      })
      .catch((err: unknown) => {
        toast(`Couldn't retry the reply: ${friendlyError(err)}`);
      })
      .finally(() => setSending(false));
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
        {isNew ? null : (
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
        )}
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
          <span className={`av ${m.who === "you" ? "you" : "ai"}`}>{m.who === "you" ? "You" : "AI"}</span>
          <div>
            <div className="who">{m.who === "you" ? "You" : m.suggested ? "Agent · suggested comment" : "Agent"}</div>
            <p dangerouslySetInnerHTML={{ __html: m.html ?? tick(m.text ?? "") }} />
            <MessageCitations citations={m.citations} />
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
          {/* Ask is the only thread turn that works without a matching
              entry or job (issue #97): its patch lands before the response
              retargets the anchor-keyed entry. Reply and retry carry their
              own entry, so the fallback is always the Ask label. */}
          <span>{busy?.label ?? inflightLabel("ask")}</span>
        </div>
      ) : null}
      {waiting ? (
        <div className="hint" role="status">
          Still waiting for the agent — its reply will appear here.
        </div>
      ) : null}
      {thread.error && !readOnly ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer: {friendlyError(thread.error)}</span>
          <button
            className="btn"
            type="button"
            data-retry={thread.id}
            disabled={sending || working}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
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
      )}
    </div>
  );
}
