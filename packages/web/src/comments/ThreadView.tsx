/**
 * Unified thread (issue #273, from #268 spike).
 *
 * One thread component for everything: Explain/Ask answers and reviewer
 * comments are replies with a `kind` (`ask`, `explain`, `comment`, with
 * `persona` reserved in the type only), marked by an avatar and an
 * accessible name (no kind badges — #315). Threads render
 * inline under the card (or description block, or diff line) they started
 * from. Controls (depth, principle) are per reply.
 * In-thread links point at reply ids; clicking one scrolls to that reply
 * and highlights it. "Collapse threads" in the review top bar collapses
 * every thread to one-line rows; expanding a row restores that thread.
 *
 * Prototype class names kept (`ithread`, `thd`, `mq`) so existing styles apply.
 */
import type { Thread, Block, Reply } from "@unvibe/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, friendlyError } from "../api/client.js";
import { useEnabledPersonas } from "../settings/usePersonas.js";
import { Icon } from "../components/Icon.js";
import { WorkingPlaceholder } from "../components/WorkingPlaceholder.js";
import { toast } from "../floating/Toast.js";
import { performAction, performInsertAction } from "../guide/actions.js";
import { BlockView } from "../guide/BlockView.js";
import { DepthControl } from "../guide/DepthControl.js";
import { linkCardBlocks } from "../guide/glossary.js";
import { busyForCard, inflightLabel } from "../guide/inflight.js";
import { useReview } from "../state/store.js";
import { Button } from "../ui/index.js";
import { isReadOnlyVersionNow } from "./readOnly.js";
import { revealThreadAnchor } from "./revealAnchor.js";
import { isNoAgentMessage, NO_AGENT_COPY } from "../guide/expansions/expansionUtils.js";
import { useProvisionalBlocks } from "../guide/expansions/streamedAnswer.js";
import { revealSource } from "../source/reveal.js";
import { ReplyBox } from "./ReplyBox.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../floating/SelectionToolbar.js";

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

/** Issue #293: an Ask question renders as a reviewer-styled entry from the
 * stored `reply.question` — no stored change, so it never enters the
 * Outbox/Submit path (those read only `kind === "comment"` replies). */
function isAskWithQuestion(reply: Reply): boolean {
  return reply.kind === "ask" && (reply.question?.trim() ?? "") !== "";
}

/** Reviewer-styled question entry for an Ask reply (#293). Issue #331:
 * the avatar floats inline so the question starts on its line, and the
 * following lines wrap back to the thread's normal padding (no avatar
 * column, no hanging indent). Issue #315: no kind chip and no
 * "Reviewer comment" label — the reviewer avatar alone says who's
 * speaking. The entry keeps an accessible name ("Your question") so
 * screen readers still tell it apart from the agent answer. */
function AskQuestionView({ reply, flash, onDelete, deleteDisabled }: { reply: Reply; flash: boolean; onDelete: () => void; deleteDisabled: boolean }): React.ReactNode {
  const question = (reply.question ?? "").trim();
  return (
    <div
      className={`spike-reply ask-question${flash ? " flash" : ""}`}
      id={`${reply.id}-question`}
      data-reply={`${reply.id}-question`}
      data-kind="comment"
      data-ask-question={reply.id}
      role="article"
      aria-label="Your question"
    >
      <span className="av you" role="img" aria-label="You">
        <Icon name="person" />
      </span>
      {/* Issue #364: each turn deletes as one (no confirm) — the
          question entry carries its answer's delete with it. */}
      <div className="ctl">
        <ControlButton icon="trash" label="Delete reply" disabled={deleteDisabled} onClick={onDelete} />
      </div>
      <p>{question}</p>
    </div>
  );
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
  hideQuestion,
  onDelete,
  deleteDisabled,
}: {
  reviewId: string;
  thread: Thread;
  reply: Reply;
  lookupPage: (pageId: string) => { id: string } | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
  flash: boolean;
  onLink: (targetId: string) => void;
  /** Issue #293: Ask renders its question as a separate reviewer entry,
   * so the answer reply carries no question heading. */
  hideQuestion?: boolean;
  /** Issue #364: per-reply delete (no confirm). */
  onDelete: () => void;
  deleteDisabled: boolean;
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

  const askAnswerClass = hideQuestion ? " ask-answer" : "";
  // Issue #315 follow-up: every agent reply shows the avatar only — no
  // kind chip, no role label. For Ask the question is its own entry just
  // above; Explain shows the answer only. The accessible name keeps the
  // replies distinguishable for screen readers.
  const agentLabel = reply.kind === "explain" ? "Agent explanation" : "Agent answer";
  // Issue #349 step 2: the AI avatar is recoloured wherever a persona
  // speaks — its threads' answers wear the persona colour (with the
  // name in the accessible label, so colour is never the only signal).
  const personas = useEnabledPersonas();
  const replyPersona = thread.personaId ? personas.find((p) => p.id === thread.personaId) : undefined;
  const avatarStyle = replyPersona ? { background: replyPersona.color, color: "#fff" } : undefined;
  const avatarLabel = replyPersona ? `${replyPersona.name} (persona)` : "Agent";
  return (
    <div
      className={`spike-reply${askAnswerClass}${flash ? " flash" : ""}`}
      id={reply.id}
      data-reply={reply.id}
      data-kind={reply.kind}
      {...(hideQuestion ? { "data-ask-answer": reply.id } : {})}
      role="article"
      aria-label={agentLabel}
    >
      <span className="av ai" role="img" aria-label={avatarLabel} {...(avatarStyle ? { style: avatarStyle } : {})}>
        <Icon name="spark" />
      </span>
      {/* #274: the toolbar floats at the reply's top-right corner,
          hover/focus-revealed, so the body starts on the avatar's line. */}
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
              {/* Issue #364: every reply deletes on its own (no confirm).
                  Deleting an answer removes its question turn with it —
                  the two are one stored reply; later turns stay. */}
              <ControlButton
                icon="trash"
                label="Delete reply"
                disabled={deleteDisabled}
                onClick={onDelete}
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
      {/* Issue #364: reverse link — back to the quoted passage (or the
          margin marker's line when the quote can't be placed), flashing it. */}
      <button
        type="button"
        className="src-link"
        data-src-link={reply.id}
        data-tip="Show the quoted passage"
        aria-label="Show the quoted passage"
        onClick={() => revealThreadAnchor(thread.id)}
      >
        <span aria-hidden="true">↑</span> quoted text
      </button>
    </div>
  );
}

/** One reviewer comment reply. */
function CommentReplyView({
  reply,
  threadId,
  flash,
  onLink,
  onDelete,
  deleteDisabled,
}: {
  reply: Reply;
  threadId: string;
  flash: boolean;
  onLink: (targetId: string) => void;
  /** Issue #364: per-reply delete (no confirm). */
  onDelete: () => void;
  deleteDisabled: boolean;
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
  // Issue #315 follow-up: a reviewer comment shows the avatar only — no
  // kind chip, no "Reviewer comment" label. The thread header's Outbox
  // toggle already shows the postable/posted state; the accessible name
  // keeps the role.
  const commentLabel = reply.kind === "persona" ? "Persona note" : "Reviewer comment";
  return (
    <div
      className={`spike-reply${flash ? " flash" : ""}`}
      id={reply.id}
      data-reply={reply.id}
      data-kind="comment"
      data-comment={threadId}
      role="article"
      aria-label={commentLabel}
    >
      <span className="av you" role="img" aria-label="You">
        <Icon name="person" />
      </span>
      {/* Issue #364: reviewer comments delete on their own too. */}
      <div className="ctl">
        <ControlButton icon="trash" label="Delete reply" disabled={deleteDisabled} onClick={onDelete} />
      </div>
      {body}
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
  // Owner decision (#331 follow-up): the count is replies after the first
  // entry — a lone opening comment shows no count, matching the header.
  const followups = thread.replies.length - 1;
  return (
    <button type="button" className="spike-row" data-row={thread.id} onClick={onExpand} aria-label={`Expand thread ${thread.anchor.quotedText}`}>
      {rowQuote !== "" ? <span className="spike-row-q">“{thread.anchor.quotedText}”</span> : null}
      <span className="spike-row-first">{firstHeading}</span>
      <span className="spike-row-sep">·</span>
      <span className="spike-row-snip">{snippet}</span>
      {followups > 0 ? (
        <span className="spike-row-count">
          {followups} {followups === 1 ? "reply" : "replies"}
        </span>
      ) : null}
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
  // Issue #364: Ask inside a thread uses this thread's own Reply box —
  // the selected quote arrives as a removable chip, never a second
  // composer. The chip is UI-local (never stored): it only rides the
  // next Reply send.
  const [quoteChip, setQuoteChip] = useState<{ quote: string; sourceReplyId?: string } | null>(null);
  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.threadId !== thread.id) return;
      if (isReadOnlyVersionNow()) return;
      setQuoteChip({ quote: req.quote, ...(req.sourceReplyId ? { sourceReplyId: req.sourceReplyId } : {}) });
      // Focus the Reply box so the quote can be answered at once.
      window.setTimeout(() => {
        document.getElementById(`ta-${thread.id}`)?.focus();
      }, 60);
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
  const navigate = useNavigate();
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
  // Latest failed agent reply: Retry is the single source of truth (#270).
  const failedReply = [...replies].reverse().find((r) => r.kind !== "comment" && r.error);
  // #271: while an answer is pending, the Reply box stays visible and
  // editable with Send disabled ("Wait for the answer").
  const hasPendingAgent = replies.some((r) => r.kind !== "comment" && ((r.working ?? "") !== "" || r.jobId !== undefined)) || ((thread.working ?? "") !== "");
  // #203: while the first agent answer is still being written (no blocks
  // yet) there is no answer for boxes to act on — show only the header
  // and the writing state.
  const firstAnswerArrived = replies.some((r) => r.kind !== "comment" && r.blocks.length > 0);

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

  // Issue #301: removed the "Ask about this" header button — the Reply
  // box at the end of every thread already asks the agent. Issue #364:
  // a pending quote chip turns the Reply send into an in-thread Ask
  // (with the in-thread reply link); otherwise it stays a plain Reply.
  const onAskFollowup = (text: string): Promise<unknown> => {
    const chip = quoteChip;
    if (!chip) return api.action(reviewId, { kind: "reply", annotationId: thread.id, message: text });
    setQuoteChip(null);
    return performAction(
      reviewId,
      {
        kind: "ask",
        quote: chip.quote,
        message: text,
        threadId: thread.id,
        ...(chip.sourceReplyId ? { sourceReplyId: chip.sourceReplyId } : {}),
      } as import("@unvibe/shared").ReviewAction,
      { toast: false },
    ).catch((err: unknown) => {
      setQuoteChip(chip);
      throw err;
    });
  };

  const onPromote = (): void => {
    void performAction(reviewId, { kind: "promote", annotationId: thread.id })
      .then((res) => {
        if (res.accepted && res.pageId) {
          navigate({
            pathname: `/review/${reviewId}/page/${encodeURIComponent(res.pageId)}`,
            search: window.location.search,
          });
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
  // Quotes anchored on code (diff lines, hunks) render upright in the
  // code font so escapes read literally; prose quotes keep italic sans.
  const codeQuote = thread.anchor.host.kind === "diff-line" || thread.anchor.host.kind === "hunk";
  return (
    <section className="ithread spike-thread" id={thread.id} data-thread={thread.id} aria-label="Thread">
      <div className="thd">
        {showQuote ? <span className={codeQuote ? "mq code" : "mq"}>“{thread.anchor.quotedText}”</span> : null}
        <span className="hint thd-loc">{headerLabel(snapshot, thread)}</span>
        {footnoted ? <span className="hint">from an earlier wording</span> : null}
        {suggestedQuestion ? <span className="qtag">Suggested question</span> : null}
        {/* Owner decision (#331 follow-up): the count is replies after the
            first entry — a lone opening comment shows no count. */}
        {replies.length > 1 ? (
          <span className="count" data-count={thread.id}>
            {replies.length - 1} {replies.length - 1 === 1 ? "reply" : "replies"}
          </span>
        ) : null}
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
      {/* Issue #364: one turn per reply — a question and its answer are
          one stored reply, so each `.turn` is one deletable unit with
          space + a divider between turns (never inside one). */}
      {replies.map((r) => {
        // Posted threads never lose replies to GitHub; a filling reply
        // can't go either (a landing job must find its turn).
        const filling = r.jobId !== undefined || (r.working ?? null) !== null;
        const deleteDisabled = readOnly || posted || filling;
        const onDeleteReply = (): void => {
          api.deleteReply(reviewId, thread.id, r.id).catch((err: unknown) => {
            toast(`Couldn't delete the reply: ${friendlyError(err)}`);
          });
        };
        if (r.kind === "comment" || r.kind === "persona") {
          return (
            <div className="turn" data-turn={r.id} key={r.id}>
              <CommentReplyView reply={r} threadId={thread.id} flash={flashId === r.id} onLink={scrollToReply} onDelete={onDeleteReply} deleteDisabled={deleteDisabled} />
            </div>
          );
        }
        // Issue #293: an Ask question is a reviewer-styled entry with the
        // answer as the reply directly under it (no stored change).
        if (isAskWithQuestion(r)) {
          return (
            <div className="turn" data-turn={r.id} key={r.id}>
              <AskQuestionView reply={r} flash={flashId === `${r.id}-question`} onDelete={onDeleteReply} deleteDisabled={deleteDisabled} />
              <AgentReplyView
                reviewId={reviewId}
                thread={thread}
                reply={r}
                lookupPage={lp}
                onOpenPage={op}
                onFollowUp={of}
                flash={flashId === r.id}
                onLink={scrollToReply}
                hideQuestion
                onDelete={onDeleteReply}
                deleteDisabled={deleteDisabled}
              />
            </div>
          );
        }
        return (
          <div className="turn" data-turn={r.id} key={r.id}>
            <AgentReplyView
              reviewId={reviewId}
              thread={thread}
              reply={r}
              lookupPage={lp}
              onOpenPage={op}
              onFollowUp={of}
              flash={flashId === r.id}
              onLink={scrollToReply}
              onDelete={onDeleteReply}
              deleteDisabled={deleteDisabled}
            />
          </div>
        );
      })}
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
      ) : suggested ? null : !firstAnswerArrived && replies.some((r) => r.kind !== "comment") ? null : isNew ? (
        <ReplyBox
          reviewId={reviewId}
          annotationId={thread.id}
          serverReply={thread.reply ?? undefined}
          placeholder="Write a comment…"
          ariaLabel="New comment"
          sendLabel="Save"
          discardLabel="Discard"
          rows={3}
          allowEmptyDiscard
          onSend={(text) => api.replyComment(reviewId, thread.id, { text })}
          onDiscard={() => api.deleteComment(reviewId, thread.id)}
        />
      ) : // Owner decision: EVERY thread ends in ONE box, labelled Reply,
      // and it asks the agent (an Ask reply in the same thread) — new,
      // comment-only and agent threads alike. Reviewer comments are
      // written elsewhere (the selection toolbar's Comment), never
      // from this box. #271 stays: while an answer is pending the box
      // stays visible and editable with Send disabled ("Wait for the
      // answer") and the draft kept; #270 stays: a failed turn hides
      // the box and Retry governs.
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
          quoteChip={quoteChip?.quote ?? null}
          onRemoveQuoteChip={() => setQuoteChip(null)}
        />
      )}
      {pendingExplain && !hasOpenCard && !readOnly ? <WorkingPlaceholder label={inflightLabel(pendingExplain[1].kind)} /> : null}
    </section>
  );
}
