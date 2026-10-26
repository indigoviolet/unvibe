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
import type { Thread, Block, Reply } from "@unvibe/shared";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { isReadOnlyVersionNow } from "./readOnly.js";
import { isNoAgentMessage, NO_AGENT_COPY } from "../guide/expansions/expansionUtils.js";
import { useProvisionalBlocks } from "../guide/expansions/streamedAnswer.js";
import { revealSource } from "../source/reveal.js";
import { ReplyBox } from "./ReplyBox.js";
import { NewThreadComposer } from "./NewThreadComposer.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../floating/SelectionToolbar.js";
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

function successorTarget(thread: Thread): string | null {
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

/** Location context for the thread header. The anchor quote itself is
 * already shown in `.mq`, so this never repeats it — it names *where*
 * the thread lives (card title / file:line / description block). */
function headerLabel(
  snapshot: import("@unvibe/shared").ReviewSnapshot | null | undefined,
  thread: Thread,
): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot?.files?.find((f) => f.fileKey === host.fileKey);
    const name = file?.path.split("/").pop() ?? host.fileKey;
    return host.endLine && host.endLine !== host.line ? `${name}:${host.line}-${host.endLine}` : `${name}:${host.line}`;
  }
  if (host.kind === "description") return "PR description";
  if (host.kind === "code") return `${host.path}:${host.line}`;
  if (host.kind === "block") {
    const cardId = host.blockId.includes("#") ? host.blockId.slice(0, host.blockId.indexOf("#")) : host.blockId;
    for (const page of snapshot?.pages ?? []) {
      const card = page.cards.find((c) => c.id === cardId);
      if (card) return card.title || page.title || "Guide";
    }
    return "Guide";
  }
  return "Comment";
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
  thread: Thread;
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

  // In-thread reply link (#268 spike): hyperlink the selected words
  // *inside this reply's own text* (dotted teal underline), pointing at
  // the target reply. The link text is plain selected text while the
  // rendered blocks carry markup, so match against live text nodes and
  // split the first one containing the phrase (never inside a button or
  // link, so citation chips stay intact). Restored before every
  // re-wrap so React's own patches never see the inserted button.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const linkBtnRef = useRef<HTMLButtonElement | null>(null);
  const unwrapLink = useCallback(() => {
    const btn = linkBtnRef.current;
    linkBtnRef.current = null;
    if (btn && btn.isConnected) btn.replaceWith(document.createTextNode(btn.textContent ?? ""));
  }, []);
  useEffect(() => {
    unwrapLink();
    const targetId = reply.linkTo;
    const phrase = reply.linkText;
    const root = bodyRef.current;
    if (!targetId || !phrase || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    let matchAt = -1;
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      // Never split inside an interactive element (citation chips etc.).
      if ((text.parentElement as HTMLElement | null)?.closest?.("button, a, [role=\"button\"]")) continue;
      const at = text.data.indexOf(phrase);
      if (at >= 0) {
        node = text;
        matchAt = at;
        break;
      }
    }
    if (!node || matchAt < 0 || !node.parentNode) return;
    const before = node.splitText(matchAt);
    const after = before.splitText(phrase.length);
    void after;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rlink";
    btn.dataset.replylink = targetId;
    btn.textContent = phrase;
    btn.addEventListener("click", () => onLink(targetId));
    node.parentNode.replaceChild(btn, before);
    linkBtnRef.current = btn;
    return unwrapLink;
  }, [reply.blocks, reply.linkTo, reply.linkText, onLink, unwrapLink]);

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
        <div className={`exp-b${provisional ? " streaming" : ""}`} ref={bodyRef}>
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
  thread: Thread;
  onExpand: () => void;
}) {
  const first = thread.replies[0];
  // Same headings as the replies themselves (spike), so the row reads
  // quote · question/kind · snippet · count.
  const firstHeading = first
    ? first.kind === "comment"
      ? "Reviewer comment"
      : first.kind === "persona"
        ? "Persona note"
        : first.kind === "explain"
          ? `Explain · “${(first.question ?? thread.anchor.quotedText ?? "").slice(0, 80)}”`
          : first.question
            ? `Ask · ${first.question.slice(0, 100)}`
            : "Ask"
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
  // Never show empty quote marks: a thread with no quoted text (e.g. a
  // line comment) is just question · snippet · count.
  const rowQuote = (thread.anchor.quotedText ?? "").trim();
  return (
    <button type="button" className="spike-row" data-row={thread.id} onClick={onExpand} aria-label={`Expand thread ${thread.anchor.quotedText}`}>
      {rowQuote !== "" ? <span className="spike-row-q">“{thread.anchor.quotedText}”</span> : null}
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
  thread: Thread;
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
  // Issue #273: Ask via the toolbar inside this thread opens its composer
  // here (the anchor names a reply block, so no guide/diff/description slot
  // would ever match it).
  const [inThreadPending, setInThreadPending] = useState<NewThreadRequest | null>(null);
  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.threadId !== thread.id) return;
      if (isReadOnlyVersionNow()) return;
      setInThreadPending(req);
    };
    window.addEventListener(NEW_THREAD_EVENT, onRequest);
    return () => window.removeEventListener(NEW_THREAD_EVENT, onRequest);
  }, [thread.id]);

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
  // Expanding a collapsed row restores its thread: mark it expanded, and
  // open it too when it was closed (a closed thread otherwise has no
  // inline view to restore).
  const doExpand =
    onExpand ??
    (() => {
      storeSetExpanded(thread.id, true);
      if (!thread.open && !readOnly) {
        api.updateComment(reviewId, thread.id, { open: true }).catch((err: unknown) => {
          toast(`Couldn't open the thread: ${friendlyError(err)}`);
        });
      }
    });
  if (isCollapsed) {
    return <ThreadCollapsedRow thread={thread} onExpand={doExpand} />;
  }

  const replies = thread.replies ?? [];
  const isNew = replies.length === 0;
  const posted = thread.postedAt !== undefined;
  const successor = successorTarget(thread);
  const suggested = replies.some((r) => r.kind === "comment" && r.suggested === true);
  const suggestedQuestion = replies.some((r) => r.kind === "comment" && r.suggestedQuestion === true);
  // Outbox toggle only when there is something postable: agent-only
  // threads carry no comment replies and Submit skips them.
  const hasCommentReplies = replies.some((r) => r.kind === "comment");
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
  // #203: while the first agent answer is still being written (no blocks
  // yet) there is no answer for boxes to act on — show only the header
  // and the writing state.
  const firstAnswerArrived = replies.some((r) => r.kind !== "comment" && r.blocks.length > 0);
  // Follow-up box only once the thread has agent replies: pure comment
  // threads keep their old single-box height (file-tab slot checks), and
  // the first agent reply arrives via ask-about or selected-text Ask.
  const hasAgentReply = replies.some((r) => r.kind !== "comment");

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
    // Closing drops the per-thread expanded override too: with
    // collapse-all on, the thread falls back to its collapsed row
    // instead of lingering inline while closed.
    storeSetExpanded(thread.id, false);
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

  const onPromote = (): void => {
    void performAction(reviewId, { kind: "promote", annotationId: thread.id })
      .then((res) => {
        if (res.accepted && res.pageId) {
          const token = new URLSearchParams(window.location.search).get("token") ?? "";
          window.location.assign(`/review/${reviewId}/page/${encodeURIComponent(res.pageId)}?token=${token}`);
        }
      })
      .catch((err: unknown) => {
        toast(`Couldn't open as page: ${friendlyError(err)}`);
      });
  };

  const footnoted = !!thread.anchorStale;
  // Never render empty quote marks: a thread with no quoted text (e.g.
  // a line comment) shows only its location. Narrow panes are handled in
  // CSS: below ~440px of thread width the quote hides entirely
  // (container query), keeping the location.
  const showQuote = (thread.anchor.quotedText ?? "").trim() !== "";
  return (
    <section className="ithread spike-thread" id={thread.id} data-thread={thread.id} aria-label="Thread">
      <div className="thd">
        {showQuote ? <span className="mq">“{thread.anchor.quotedText}”</span> : null}
        <span className="hint thd-loc">{headerLabel(snapshot, thread)}</span>
        {footnoted ? <span className="hint">from an earlier wording</span> : null}
        {suggestedQuestion ? <span className="qtag">Suggested question</span> : null}
        <span className="count" data-count={thread.id}>
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </span>
        {!isNew && hasCommentReplies ? (
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
        {!isNew && !readOnly ? (
          <button
            className="ib"
            type="button"
            data-tip="Open as page"
            aria-label="Open as page"
            data-open-page={thread.id}
            onClick={onPromote}
          >
            <Icon name="open" />
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
      {threadWorking && !threadError && !replies.some((r) => r.kind !== "comment" && (r.working ?? "") !== "") ? (
        <Working text={typeof thread.working === "string" ? thread.working : "Working"} />
      ) : null}
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
      {inThreadPending && !readOnly ? (
        <NewThreadComposer
          key="in-thread-pending"
          reviewId={reviewId}
          anchor={inThreadPending.anchor}
          quote={inThreadPending.quote}
          kind={inThreadPending.kind}
          initialText={inThreadPending.initialText}
          offsets={inThreadPending.offsets}
          threadId={inThreadPending.threadId}
          sourceReplyId={inThreadPending.sourceReplyId}
          onDiscard={() => setInThreadPending(null)}
          onCreated={() => setInThreadPending(null)}
        />
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
      ) : suggested ? null : !firstAnswerArrived && replies.some((r) => r.kind !== "comment") ? null : hasAgentReply ? (
        // Owner decision: a thread with agent replies ends in ONE box,
        // labelled Reply, and it asks the agent (the old "Ask a follow-up"
        // box). Reviewer comments are written elsewhere, never from this
        // box. #271 stays: while an answer is pending the box stays
        // visible and editable with Send disabled ("Wait for the answer")
        // and the draft kept; #270 stays: a failed turn hides the box
        // and Retry governs.
        failedReply ? null : (
          <ReplyBox
            reviewId={reviewId}
            annotationId={thread.id}
            serverReply={thread.followupDraft ?? undefined}
            placeholder="Ask a follow-up…"
            ariaLabel="Reply"
            sendLabel="Reply"
            discardLabel="Clear"
            rows={1}
            allowEmptyDiscard
            sendDisabled={hasPendingAgent}
            sendDisabledTip={hasPendingAgent ? "Wait for the answer" : undefined}
            persistField="followupDraft"
            onSend={onAskFollowup}
            onDiscard={() => api.updateComment(reviewId, thread.id, { followupDraft: null })}
          />
        )
      ) : (
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
      )}
      {pendingExplain && !hasOpenCard && !readOnly ? <WorkingPlaceholder label={inflightLabel(pendingExplain[1].kind)} /> : null}
    </section>
  );
}
