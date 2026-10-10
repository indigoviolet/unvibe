/**
 * Expansion card (M4 interaction; PRD §4.7 + §4.4 + §4.10 + §4.15).
 *
 * Ported behaviour from `prototype.html` (not code):
 * - header: quoted text, then Open as page, Delete, Close; chevron first
 *   when collapsed, × always last;
 * - below that the standard card controls (depth stepper with three dots,
 *   Use examples, Add diagram, Undo, Second opinion, Mark read) acting on
 *   the expansion (cardId = annotation id);
 * - working state with streamed text while the job runs; error state with
 *   Retry; "no agent configured" state;
 * - anchor-stale shows a collapsed card instead;
 * - marking read closes the same way Close does;
 * - typed text elsewhere survives: this component holds no input state and
 *   preserves React keys, so reply-box drafts are untouched.
 */
import type { Annotation, Page } from "@unvibe/shared";
import { Fragment } from "react";
import { Icon } from "../../components/Icon.js";
import { toast } from "../../floating/Toast.js";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { performAction } from "../actions.js";
import { BlockView } from "../BlockView.js";
import { jobForCard } from "../guideUtils.js";
import { SecondOpinionBlock, SecondOpinionControl } from "../secondOpinion/index.js";
import { isAnchorStale, isNoAgentMessage, NO_AGENT_COPY } from "./expansionUtils.js";

const DEPTH_ORDER = ["simple", "standard", "deep"] as const;
type Depth = (typeof DEPTH_ORDER)[number];

function ControlButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: "down" | "right" | "check" | "bulb" | "diagram" | "undo" | "trash" | "x" | "open";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      className="ib"
      type="button"
      data-tip={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function Working({ text, stream }: { text: string; stream?: string }) {
  return (
    <div className="working" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{text}</span>
      {stream ? <span className="stream">{stream.slice(-160)}</span> : null}
    </div>
  );
}

function actionErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNoAgentError(err: unknown): boolean {
  return isNoAgentMessage(actionErrorMessage(err));
}

interface Props {
  reviewId: string;
  expansion: Annotation;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
}

/** Full expansion card: header + standard controls + blocks. */
export function ExpansionCard({ reviewId, expansion, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const streams = useReview((s) => s.streams);
  const jobs = snapshot?.jobs ?? [];
  const body = expansion.expansion;
  if (expansion.type !== "expansion" || !body) return null;

  const stale = isAnchorStale(expansion);
  const job = jobForCard(jobs, expansion.id);
  const streamText = streams[expansion.id];
  const workingText =
    expansion.working ?? body.working ?? job?.progress ?? (streamText ? streamText.slice(-160) : undefined);
  const showWorking = !!job || !!streamText || !!workingText;
  const errorText = expansion.error ?? body.error ?? null;
  const noAgent = isNoAgentMessage(errorText);

  const depthIndex = DEPTH_ORDER.indexOf(body.level as Depth);
  const safeDepthIndex = depthIndex < 0 ? 1 : depthIndex;
  const undoEnabled = (body.undoStack?.length ?? 0) > 0;

  const run = (action: Parameters<typeof performAction>[1]): void => {
    void performAction(reviewId, action).catch((err: unknown) => {
      if (isNoAgentError(err)) toast(NO_AGENT_COPY);
      else toast(`Action failed: ${actionErrorMessage(err)}`);
    });
  };

  const onRetry = (): void => {
    void api
      .action(reviewId, { kind: "retry", threadId: expansion.id })
      .catch((err: unknown) => {
        // Retry rebuilds the failed fill on the same annotation id. When
        // the service has no retryable failure (e.g. mock mode), fall back
        // to re-explaining the same quote so the button still recovers.
        void api
          .action(reviewId, {
            kind: "explain",
            quote: expansion.anchor.quotedText,
            anchor: toActionAnchor(expansion),
          })
          .catch((e2: unknown) => {
            if (isNoAgentError(e2) || isNoAgentError(err)) toast(NO_AGENT_COPY);
            else toast(`Retry failed: ${actionErrorMessage(e2)}`);
          });
      });
  };

  const onPromote = (): void => {
    void api
      .action(reviewId, { kind: "promote", annotationId: expansion.id })
      .then((res) => {
        if (res.accepted && res.pageId) onOpenPage(res.pageId);
        else if (!res.accepted) toast("Needs the service to open this as a page.");
      })
      .catch((err: unknown) => {
        toast(`Couldn't open as a page: ${actionErrorMessage(err)}`);
      });
  };

  const onDelete = (): void => {
    void api
      .action(reviewId, { kind: "delete", targetId: expansion.id })
      .catch((err: unknown) => {
        toast(`Couldn't delete: ${actionErrorMessage(err)}`);
      });
  };

  const onClose = (): void => {
    // Cancel-on-close: the service cancels the annotation's job.
    void api
      .action(reviewId, { kind: "close", annotationId: expansion.id })
      .catch(() => {
        // Closed expansions fall back to the comment-patch path so the
        // dotted link still appears when the actions route is unavailable.
        void api.updateComment(reviewId, expansion.id, { open: false }).catch(() => {});
      });
  };

  const onExpand = (): void => {
    void api.updateComment(reviewId, expansion.id, { open: true }).catch((err: unknown) => {
      toast(`Couldn't expand: ${actionErrorMessage(err)}`);
    });
  };

  // Anchor-stale fallback: a collapsed card instead of in-place content.
  if (stale) {
    return (
      <section className="card child collapsed" id={`B-${expansion.id}`} data-expansion={expansion.id}>
        <div className="exp-h">
          <ControlButton icon="right" label="Expand" onClick={onExpand} />
          {expansion.anchor.quotedText ? <q>{expansion.anchor.quotedText}</q> : null}
          <span className="hint">Anchor text not found</span>
          <span className="sp" />
          <ControlButton icon="open" label="Open as page" onClick={onPromote} />
          <ControlButton icon="trash" label="Delete" onClick={onDelete} />
          <ControlButton icon="x" label="Close" onClick={onClose} />
        </div>
      </section>
    );
  }

  if (body.collapsed) {
    return (
      <section
        className={`card child collapsed${body.read ? " read" : ""}`}
        id={`B-${expansion.id}`}
        data-expansion={expansion.id}
      >
        <div className="exp-h">
          <ControlButton icon="right" label="Expand" onClick={() => run({ kind: "collapse", cardId: expansion.id, collapsed: false })} />
          {expansion.anchor.quotedText ? <q>{expansion.anchor.quotedText}</q> : null}
          <span className="sp" />
          <ControlButton icon="open" label="Open as page" onClick={onPromote} />
          <ControlButton icon="trash" label="Delete" onClick={onDelete} />
          {body.read ? (
            <ControlButton
              icon="check"
              label="Mark unread"
              pressed
              onClick={() => run({ kind: "read", cardId: expansion.id, read: false })}
            />
          ) : (
            <ControlButton icon="x" label="Close" onClick={onClose} />
          )}
        </div>
      </section>
    );
  }

  const secondOpinions = body.secondOpinions ?? [];

  return (
    <section
      className={`card child${body.read ? " read" : ""}`}
      id={`B-${expansion.id}`}
      data-expansion={expansion.id}
    >
      <div className="exp-h">
        {expansion.anchor.quotedText ? <q>{expansion.anchor.quotedText}</q> : null}
        <span className="sp" />
        <ControlButton icon="open" label="Open as page" onClick={onPromote} />
        <ControlButton icon="trash" label="Delete" onClick={onDelete} />
        <ControlButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className="ctl">
        <span className="depth" role="group" aria-label="Depth">
          <button
            type="button"
            data-tip="Simpler"
            aria-label="Simpler"
            disabled={safeDepthIndex <= 0}
            onClick={() => run({ kind: "depth", cardId: expansion.id, direction: "simpler" })}
          >
            −
          </button>
          <span className="dl" data-tip="Depth">
            <span className="pips" aria-hidden="true">
              {DEPTH_ORDER.map((_, j) => (
                <i key={j} className={j <= safeDepthIndex ? "on" : ""} />
              ))}
            </span>
          </span>
          <button
            type="button"
            data-tip="Deeper"
            aria-label="Deeper"
            onClick={() => run({ kind: "depth", cardId: expansion.id, direction: "deeper" })}
          >
            +
          </button>
        </span>
        <ControlButton
          icon="bulb"
          label="Use examples"
          onClick={() => run({ kind: "examples", cardId: expansion.id })}
        />
        <ControlButton
          icon="diagram"
          label="Add diagram"
          onClick={() => run({ kind: "diagram", cardId: expansion.id })}
        />
        <ControlButton
          icon="undo"
          label="Undo"
          disabled={!undoEnabled}
          onClick={() => run({ kind: "undo", cardId: expansion.id })}
        />
        <ExpansionSecondOpinion reviewId={reviewId} expansion={expansion} lookupPage={lookupPage} />
        <span className="sp" />
        <ControlButton
          icon="check"
          label={body.read ? "Mark unread" : "Mark read"}
          pressed={body.read}
          onClick={() => run({ kind: "read", cardId: expansion.id, read: !body.read })}
        />
      </div>
      {showWorking && !errorText ? <Working text={workingText ?? "Working…"} stream={streamText} /> : null}
      {noAgent ? (
        <div className="perr" role="status">
          <span>{NO_AGENT_COPY}</span>
        </div>
      ) : null}
      {errorText && !noAgent ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer: {errorText}</span>
          <button className="btn" type="button" data-retry={expansion.id} onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="exp-b">
        {body.blocks.map((block) => (
          <Fragment key={block.id}>
            <BlockView
              block={block}
              level={body.level}
              threads={[]}
              lookupPage={lookupPage}
              onOpenPage={onOpenPage}
              onFollowUp={(blockId, index) => onFollowUp(expansion.id, blockId, index)}
            />
          </Fragment>
        ))}
      </div>
      {(secondOpinions).map((so) => (
        <SecondOpinionBlock
          key={so.id}
          reviewId={reviewId}
          card={{ id: expansion.id } as never}
          result={so}
          lookupPage={lookupPage}
          onOpenPage={onOpenPage}
          onFollowUp={(cardId, blockId, index) => onFollowUp(cardId, blockId, index)}
        />
      ))}
    </section>
  );
}

function toActionAnchor(expansion: Annotation): import("@unvibe/shared").ActionAnchor {
  const host = expansion.anchor.host;
  if (host.kind === "block") return { where: "block", blockId: host.blockId };
  if (host.kind === "description") return { where: "description", paragraphId: host.paragraphId };
  return { where: "diff-line", fileKey: host.fileKey, line: host.line };
}

function ExpansionSecondOpinion({
  reviewId,
  expansion,
  lookupPage,
}: {
  reviewId: string;
  expansion: Annotation;
  lookupPage: (pageId: string) => Page | undefined;
}) {
  // Expansions reuse the card control with the annotation id as cardId; the
  // service resolves expansion targets (M4 fix) and stores the result on the
  // expansion body so depth/undo leave it attached.
  void lookupPage;
  return <SecondOpinionControl reviewId={reviewId} card={{ id: expansion.id } as never} page={undefined} />;
}
