/**
 * Unified thread (issue #273, from #268 spike).
 *
 * One thread component for everything: Explain/Ask answers and reviewer
 * comments are replies with a `kind` (`ask`, `explain`, `comment`, with
 * `persona` reserved in the type only), badged by kind. Threads render
 * inline under the card (or description block, or diff line) they started
 * from. Controls (depth, principle, second opinion) are per reply.
 * In-thread links point at reply ids; clicking one scrolls to that reply
 * and highlights it. "Collapse threads" in the guide pane header collapses
 * every thread to one-line rows; expanding a row restores that thread.
 *
 * Prototype class names kept (`ithread`, `thd`, `mq`) so existing styles apply.
 */
import type { Annotation, Block, Reply } from "@unvibe/shared";
import { useCallback, useEffect, useState } from "react";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { WorkingPlaceholder } from "../components/WorkingPlaceholder.js";
import { toast } from "../floating/Toast.js";
import { performAction, performInsertAction } from "../guide/actions.js";
import { BlockView } from "../guide/BlockView.js";
import { DepthControl } from "../guide/DepthControl.js";
import { linkCardBlocks } from "../guide/glossary.js";
import { busyForCard, inflightLabel } from "../guide/inflight.js";
import { SecondOpinionBlock, SecondOpinionControl } from "../guide/secondOpinion/index.js";
import { useReview } from "../state/store.js";
import { Button } from "../ui/index.js";
import { isNoAgentMessage, NO_AGENT_COPY } from "../guide/expansions/expansionUtils.js";
import { useProvisionalBlocks } from "../guide/expansions/streamedAnswer.js";
import { revealSource } from "../source/reveal.js";
import { ReplyBox } from "./ReplyBox.js";
import { threadPostText } from "./threads.js";

const DEPTH_ORDER = ["simple", "standard", "deep"] as const;
type Depth = (typeof DEPTH_ORDER)[number];

function isNoAgentError(err: unknown): boolean {
  return isNoAgentMessage(err instanceof Error ? err.message : String(err));
}

function Working({ text }: { text: string }) {
  return (
    <div className="working" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{text}</span>
    </div>
  );
}

function ControlButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  busy,
}: {
  icon: "down" | "right" | "bulb" | "diagram" | "undo" | "trash" | "x" | "open";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      className="ib"
      type="button"
      data-tip={busy ? "Working…" : label}
      aria-label={busy ? "Working…" : label}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? (
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Icon name={icon} />
      )}
    </button>
  );
}

function successorTarget(thread: Annotation): string | null {
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
  return "Thread";
}

function replyHeading(reply: Reply, anchorQuote: string): string {
  if (reply.kind === "comment") return "Reviewer comment";
  if (reply.kind === "persona") return "Persona note";
  if (reply.kind === "explain") {
    const q = reply.question ?? anchorQuote;
    return `Explain · “${q.length > 80 ? `${q.slice(0, 79)}…` : q}”`;
  }
  const q = reply.question ?? "";
  return q ? `Ask · ${q.length > 100 ? `${q.slice(0, 99)}…` : q}` : "Ask";
}

/** One agent reply with its per-reply controls. */
function AgentReplyView({
  reviewId,
  thread,
  reply,
  lookupPage,
  onOpenPage,
  onFollowUp,
  flash,
  onLink,
}: {
  reviewId: string;
  thread: Annotation;
  reply: Reply;
  lookupPage: (pageId: string) => { id: string } | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
  flash: boolean;
  onLink: (targetId: string) => void;
}) {
  const snapshot = useReview((s) => s.snapshot);
  const inflight = useReview((s) => s.inflight);
  const jobs = snapshot?.jobs ?? [];
  const direct = busyForCard(inflight, jobs, reply.id);
  const serverWorking = (reply.working ?? "") !== "" && reply.working !== null;
  const showWorking = !!direct || serverWorking;
  const workingLabel = direct?.label ?? (typeof reply.working === "string" && reply.working ? reply.working : "Working");
  const errorText = reply.error ?? null;
  const noAgent = isNoAgentMessage(errorText);
  const depthIndex = DEPTH_ORDER.indexOf(reply.level as Depth);
  const safeDepthIndex = depthIndex < 0 ? 1 : depthIndex;
  const undoEnabled = (reply.undoStack?.length ?? 0) > 0;
  const run = (action: Parameters<typeof performAction>[1]): void => {
    void performAction(reviewId, action).catch((err: unknown) => {
      if (isNoAgentError(err)) toast(NO_AGENT_COPY);
      else toast(`Couldn't do that: ${friendlyError(err)}`);
    });
  };
  const onRetry = (): void => {
    void performAction(reviewId, { kind: "retry", annotationId: thread.id }).catch((err: unknown) => {
      if (isNoAgentError(err)) toast(NO_AGENT_COPY);
      else toast(`Couldn't retry: ${friendlyError(err)}`);
    });
  };
  const secondOpinions = reply.secondOpinions ?? [];
  const controlsBusy = direct !== null;
  const busyKind = direct?.kind;
  const depthBusy = busyKind === "depth";
  const contentReady = reply.blocks.length > 0 && !controlsBusy;
  const provisional = useProvisionalBlocks(thread.id, reply as unknown as Parameters<typeof useProvisionalBlocks>[1], showWorking && !errorText);
  const awaitingAnswer = !!errorText || (showWorking && (serverWorking || reply.blocks.length === 0));

  const renderBlocks = (blocks: Block[]): React.ReactNode =>
    linkCardBlocks(blocks, snapshot?.glossary ?? [], reply.level).map((block) => (
      <BlockView
        key={block.id}
        block={block}
        level={reply.level}
        threads={[]}
        lookupPage={lookupPage as never}
        cardId={reply.id}
        onOpenPage={onOpenPage}
        onFollowUp={(blockId, index) => onFollowUp(reply.id, blockId, index)}
      />
    ));

  return (
    <div className={`spike-reply${flash ? " flash" : ""}`} id={reply.id} data-reply={reply.id} data-kind={reply.kind}>
      <span className="av ai" role="img" aria-label="Agent">
        <Icon name="spark" />
      </span>
      <div className="spike-reply-main">
        <div className="spike-reply-head">
          <span className={`kind kind-${reply.kind}`}>{reply.kind}</span>
          <span className="ans-q">{replyHeading(reply, thread.anchor.quotedText ?? "")}</span>
        </div>
        {reply.linkTo ? null : null}
        {awaitingAnswer ? null : (
          <div className="ctl">
            <DepthControl
              level={reply.level}
              disabled={!contentReady}
              depthBusy={depthBusy}
              simplerAtLimit={safeDepthIndex <= 0}
              onSimpler={() => run({ kind: "depth", cardId: reply.id, direction: "simpler" })}
              onDeeper={() => run({ kind: "depth", cardId: reply.id, direction: "deeper" })}
            />
            <ControlButton
              icon="bulb"
              label="Use examples"
              busy={busyKind === "examples"}
              disabled={!contentReady}
              onClick={() => performInsertAction(reviewId, reply.id, "examples")}
            />
            <ControlButton
              icon="diagram"
              label="Add diagram"
              busy={busyKind === "diagram"}
              disabled={!contentReady}
              onClick={() => performInsertAction(reviewId, reply.id, "diagram")}
            />
            <ControlButton
              icon="undo"
              label="Undo"
              disabled={!undoEnabled || controlsBusy}
              onClick={() => run({ kind: "undo", cardId: reply.id })}
            />
            <SecondOpinionControl
              reviewId={reviewId}
              card={{ ...reply, pageId: "", title: reply.question, collapsed: false } as never}
              page={undefined}
              disabled={!contentReady}
              busy={busyKind === "second_opinion"}
            />
          </div>
        )}
        {showWorking && !errorText ? <Working text={workingLabel} /> : null}
        {noAgent ? (
          <div className="perr" role="status">
            <span>{NO_AGENT_COPY}</span>
          </div>
        ) : null}
        {errorText && !noAgent ? (
          <div className="perr" role="alert">
            <span>Couldn't get an answer. Retry, or see Debug for details.</span>
            <Button variant="primary" size="sm" type="button" data-retry={reply.id} disabled={controlsBusy} onClick={onRetry}>
              {controlsBusy ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : null}
        <div className={`exp-b${provisional ? " streaming" : ""}`}>
          {provisional?.map((block) => (
            <BlockView
              key={block.id}
              block={block}
              level={reply.level}
              threads={[]}
              lookupPage={lookupPage as never}
              cardId={reply.id}
              onOpenPage={onOpenPage}
              onFollowUp={(blockId, index) => onFollowUp(reply.id, blockId, index)}
            />
          ))}
          {renderBlocks(provisional ? [] : reply.blocks)}
        </div>
        {reply.linkTo ? (
          <div className="hint">
            <button type="button" className="rlink" data-replylink={reply.linkTo} onClick={() => onLink(reply.linkTo as string)}>
              {reply.linkText ?? "Jump to reply →"}
            </button>
          </div>
        ) : null}
        {secondOpinions.map((so) => (
          <SecondOpinionBlock
            key={so.id}
            reviewId={reviewId}
            card={{ ...reply, pageId: "", title: reply.question, collapsed: false } as never}
            result={so}
            lookupPage={lookupPage as never}
            onOpenPage={onOpenPage}
            onFollowUp={onFollowUp}
          />
        ))}
      </div>
    </div>
  );
}

/** One reviewer comment reply. */
function CommentReplyView({
  reply,
  threadId,
  flash,
  onLink,
}: {
  reply: Reply;
  threadId: string;
  flash: boolean;
  onLink: (targetId: string) => void;
}) {
  const html = reply.blocks
    .map((b) => {
      if (b.type === "paragraph") return b.text.standard;
      if (b.type === "list") return b.items.map((it) => it.html).join("<br>");
      if (b.type === "code") return `<pre>${b.code.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
      return "";
    })
    .join("");
  // In-thread link: the source reply carries linkTo/linkText (spike shape).
  // Render the link text as a button that jumps to the target reply.
  const linkTo = reply.linkTo;
  const linkText = reply.linkText;
  let body: React.ReactNode;
  if (linkTo && linkText && html.includes(linkText)) {
    const idx = html.indexOf(linkText);
    const before = html.slice(0, idx);
    const after = html.slice(idx + linkText.length);
    body = (
      <p>
        <span dangerouslySetInnerHTML={{ __html: before }} />
        <button type="button" className="rlink" data-replylink={linkTo} onClick={() => onLink(linkTo)}>
          {linkText}
        </button>
        <span dangerouslySetInnerHTML={{ __html: after }} />
      </p>
    );
  } else {
    body = <p dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className={`spike-reply${flash ? " flash" : ""}`} id={reply.id} data-reply={reply.id} data-kind="comment" data-comment={threadId}>
      <span className="av you" role="img" aria-label="You">
        <Icon name="person" />
      </span>
      <div className="spike-reply-main">
        <div className="spike-reply-head">
          <span className="kind kind-comment">comment</span>
          <span className="ans-q">Reviewer comment</span>
        </div>
        {body}
      </div>
    </div>
  );
}

export function ThreadCollapsedRow({
  thread,
  onExpand,
}: {
  thread: Annotation;
  onExpand: () => void;
}) {
  const first = thread.replies[0];
  const firstHeading = first
    ? first.kind === "comment"
      ? "Reviewer comment"
      : (first.question ?? thread.anchor.quotedText ?? "")
    : "";
  const last = thread.replies[thread.replies.length - 1];
  const lastText = last
    ? last.blocks
        .map((b) => {
          if (b.type === "paragraph") return b.text.standard.replace(/<[^>]*>/g, " ");
          return "";
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const snippet = lastText.length > 90 ? `${lastText.slice(0, 89)}…` : lastText;
  return (
    <button type="button" className="spike-row" data-row={thread.id} onClick={onExpand} aria-label={`Expand thread ${thread.anchor.quotedText}`}>
      <span className="spike-row-q">“{thread.anchor.quotedText}”</span>
      <span className="spike-row-first">{firstHeading}</span>
      <span className="spike-row-sep">·</span>
      <span className="spike-row-snip">{snippet}</span>
      <span className="spike-row-count">
        {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
      </span>
      <Icon name="right" />
    </button>
  );
}

interface Props {
  reviewId: string;
  thread: Annotation;
  readOnly?: boolean;
  lookupPage?: (pageId: string) => { id: string } | undefined;
  onOpenPage?: (pageId: string) => void;
  onFollowUp?: (cardId: string, blockId: string, index: number) => void;
  collapsed?: boolean;
  onExpand?: () => void;
}

export function ThreadView({ reviewId, thread, readOnly, lookupPage, onOpenPage, onFollowUp, collapsed, onExpand }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const inflight = useReview((s) => s.inflight);
  const storeCollapseAll = useReview((s) => s.collapseAll);
  const storeExpanded = useReview((s) => s.expandedThreads);
  const storeSetExpanded = useReview((s) => s.setThreadExpanded);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2400);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const scrollToReply = useCallback((targetId: string) => {
    setFlashId(targetId);
    window.setTimeout(() => {
      const el = document.getElementById(targetId);
      if (!el) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }, 30);
  }, []);

  const noopPage = useCallback(() => undefined, []);
  const noopOpen = useCallback(() => {}, []);
  const noopFollow = useCallback(() => {}, []);
  const lp = (lookupPage ?? noopPage) as (pageId: string) => never;
  const op = onOpenPage ?? noopOpen;
  const of = onFollowUp ?? noopFollow;

  const isCollapsed = collapsed ?? (storeCollapseAll && !storeExpanded[thread.id]);
  const doExpand = onExpand ?? (() => storeSetExpanded(thread.id, true));
  if (isCollapsed) {
    return <ThreadCollapsedRow thread={thread} onExpand={doExpand} />;
  }

  const host = thread.anchor.host;
  const file =
    host.kind === "diff-line"
      ? (snapshot?.files.find((f) => f.fileKey === host.fileKey)?.path.split("/").pop() ?? null)
      : null;
  const replies = thread.replies ?? [];
  const isNew = replies.length === 0;
  const posted = thread.postedAt !== undefined;
  const successor = successorTarget(thread);
  const suggested = replies.some((r) => r.kind === "comment" && r.suggested === true);
  const suggestedQuestion = replies.some((r) => r.kind === "comment" && r.suggestedQuestion === true);
  const commentCards = (snapshot?.annotations ?? []).filter(
    (a) => a.anchor.host.kind === "comment" && a.anchor.host.commentId === thread.id,
  );
  const pendingExplain = Object.entries(inflight).find(
    ([k, v]) => (k === `explain:comment:${thread.id}` || k === `ask:comment:${thread.id}`) && (v.kind === "explain" || v.kind === "ask"),
  );
  const hasOpenCard = commentCards.some((a) => a.open);
  const threadWorking = (thread.working ?? "") !== "" && thread.working !== null;
  const threadError = thread.error ?? null;
  // Latest failed agent reply for the thread-level banner (Retry as single source of truth, #270).
  const failedReply = [...replies].reverse().find((r) => r.kind !== "comment" && r.error);
  // #271: while a follow-up is pending, the comment Reply stays disabled
  // ("Wait for the answer"); the Ask follow-up box keeps its draft.
  const hasPendingAgent = replies.some((r) => r.kind !== "comment" && ((r.working ?? "") !== "" || r.jobId !== undefined)) || ((thread.working ?? "") !== "");

  const onRetryThread = (): void => {
    void performAction(reviewId, { kind: "retry", annotationId: thread.id }).catch((err: unknown) => {
      toast(`Couldn't retry: ${friendlyError(err)}`);
    });
  };

  const togglePost = (): void => {
    api.updateComment(reviewId, thread.id, { post: !thread.post }).catch((err: unknown) => {
      toast(`Couldn't update the Outbox: ${friendlyError(err)}`);
    });
  };

  const onDelete = (): void => {
    api.deleteComment(reviewId, thread.id).catch((err: unknown) => {
      toast(`Couldn't delete the thread: ${friendlyError(err)}`);
    });
  };

  const onClose = (): void => {
    api.updateComment(reviewId, thread.id, { open: false }).catch((err: unknown) => {
      toast(`Couldn't close the thread: ${friendlyError(err)}`);
    });
  };

  const onAskAbout = (): void => {
    const text = threadPostText(thread).trim();
    if (!text) {
      toast("Write the comment first, then ask about it");
      return;
    }
    void performAction(
      reviewId,
      { kind: "ask", quote: text, threadId: thread.id, message: text } as import("@unvibe/shared").ReviewAction,
      { toast: false },
    ).catch((err: unknown) => {
      toast(`Couldn't ask the agent: ${friendlyError(err)}`);
    });
  };

  const onAskFollowup = (text: string): Promise<unknown> => api.action(reviewId, { kind: "reply", annotationId: thread.id, message: text });

  const footnoted = !!thread.anchorStale;
  return (
    <section className="ithread spike-thread" id={thread.id} data-thread={thread.id} aria-label="Thread">
      <div className="thd">
        <span className="mq">“{thread.anchor.quotedText}”</span>
        <span className="hint">{headerLabel(file, thread)}</span>
        {footnoted ? <span className="hint">from an earlier wording</span> : null}
        {suggestedQuestion ? <span className="qtag">Suggested question</span> : null}
        <span className="count" data-count={thread.id}>
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </span>
        {!isNew ? (
          <button
            className="ib pr"
            type="button"
            data-tip={readOnly ? "Viewing an older version · read-only" : thread.post ? "Remove from the Outbox" : "Add to Outbox"}
            aria-label={thread.post ? "Remove from the Outbox" : "Add to Outbox"}
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
            data-tip="Ask about this"
            aria-label="Ask about this"
            data-ask-about={thread.id}
            onClick={onAskAbout}
          >
            <Icon name="spark" />
          </button>
        ) : null}
        <button className="ib" type="button" data-tip={readOnly ? "Viewing an older version · read-only" : "Delete"} aria-label="Delete" data-remove={thread.id} disabled={readOnly} onClick={onDelete}>
          <Icon name="trash" />
        </button>
        {isNew ? null : (
          <button className="ib" type="button" data-tip={readOnly ? "Viewing an older version · read-only" : "Close"} aria-label="Close" data-closethr={thread.id} disabled={readOnly} onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </div>
      {thread.outdated ? (
        <div className="pv outdated">
          <div className="q">Outdated · the code changed</div>
          {thread.originalSnippet ? <div className="snip">{thread.originalSnippet.slice(0, 200)}</div> : null}
          {successor ? (
            <button className="cite" type="button" onClick={() => revealSource(successor)}>
              <span className="loc">See the new code →</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {threadWorking && !threadError ? <Working text={typeof thread.working === "string" ? thread.working : "Working"} /> : null}
      {threadError && !failedReply ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer. Retry, or see Debug for details.</span>
          <Button variant="primary" size="sm" type="button" onClick={onRetryThread}>
            Retry
          </Button>
        </div>
      ) : null}
      {replies.map((r) =>
        r.kind === "comment" || r.kind === "persona" ? (
          <CommentReplyView key={r.id} reply={r} threadId={thread.id} flash={flashId === r.id} onLink={scrollToReply} />
        ) : (
          <AgentReplyView
            key={r.id}
            reviewId={reviewId}
            thread={thread}
            reply={r}
            lookupPage={lp}
            onOpenPage={op}
            onFollowUp={of}
            flash={flashId === r.id}
            onLink={scrollToReply}
          />
        ),
      )}
      {failedReply && threadError ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer. Retry, or see Debug for details.</span>
          <Button variant="primary" size="sm" type="button" data-retry={failedReply.id} onClick={onRetryThread}>
            Retry
          </Button>
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
      ) : suggested ? null : (
        <>
          <ReplyBox
            reviewId={reviewId}
            annotationId={thread.id}
            serverReply={thread.reply ?? undefined}
            placeholder={isNew ? "Write a comment…" : "Reply…"}
            ariaLabel={isNew ? "New comment" : "Reply"}
            sendLabel={isNew ? "Save" : "Reply"}
            discardLabel="Discard"
            rows={isNew ? 3 : 1}
            allowEmptyDiscard={isNew}
            sendDisabled={!isNew && hasPendingAgent}
            sendDisabledTip={!isNew && hasPendingAgent ? "Wait for the answer" : undefined}
            onSend={(text) => api.replyComment(reviewId, thread.id, { text })}
            onDiscard={() => (isNew ? api.deleteComment(reviewId, thread.id) : api.updateComment(reviewId, thread.id, { reply: null }))}
          />
          {!isNew && !failedReply ? (
            <ReplyBox
              reviewId={reviewId}
              annotationId={thread.id}
              serverReply={thread.followupDraft ?? undefined}
              placeholder="Ask a follow-up…"
              ariaLabel="Ask a follow-up"
              sendLabel="Ask"
              discardLabel="Clear"
              rows={1}
              allowEmptyDiscard
              sendDisabled={hasPendingAgent}
              sendDisabledTip={hasPendingAgent ? "Wait for the answer" : undefined}
              persistField="followupDraft"
              onSend={onAskFollowup}
              onDiscard={() => api.updateComment(reviewId, thread.id, { followupDraft: null })}
            />
          ) : null}
        </>
      )}
      {pendingExplain && !hasOpenCard && !readOnly ? <WorkingPlaceholder label={inflightLabel(pendingExplain[1].kind)} /> : null}
    </section>
  );
}
