/**
 * Expansion card (M4 interaction; PRD §4.7 + §4.4 + §4.10 + §4.15).
 *
 * Ported behaviour from `prototype.html` (not code):
 * - header: quoted text, then Open as page, Delete, Close; chevron first
 *   when collapsed, × always last;
 * - below that the standard card controls (depth stepper with three dots,
 *   Use examples, Add diagram, Undo, Second opinion, Mark read) acting on
 *   the expansion (cardId = annotation id);
 * - plain working state with a fixed label while an action runs for the
 *   expansion (in-flight entry, then the job); error state with Retry;
 *   "no agent configured" state;
 * - open cards stay in place when the anchor phrase is footnoted (issue
 *   #72); the header adds a muted "from an earlier wording" hint;
 * - marking read closes the same way Close does;
 * - typed text elsewhere survives: this component holds no input state and
 *   preserves React keys, so reply-box drafts are untouched.
 */
import type { Annotation, Page } from "@unvibe/shared";
import { Fragment } from "react";
import { Icon } from "../../components/Icon.js";
import { toast } from "../../floating/Toast.js";
import { api, friendlyError } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { performAction, performInsertAction } from "../actions.js";
import { BlockView } from "../BlockView.js";
import { busyForExpansion } from "../inflight.js";
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
  busy,
}: {
  icon: "down" | "right" | "check" | "bulb" | "diagram" | "undo" | "trash" | "x" | "open";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** This control's action is running: dots in place of the icon. */
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

/**
 * Plain processing indicator: dots plus a short fixed label. Never
 * streamed agent text, thinking text, or progress strings (issue #46).
 */
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
  const inflight = useReview((s) => s.inflight);
  const jobs = snapshot?.jobs ?? [];
  const body = expansion.expansion;
  if (expansion.type !== "expansion" || !body) return null;

  const stale = isAnchorStale(expansion);
  const busy = busyForExpansion(inflight, jobs, snapshot, expansion);
  // The service marks the annotation working while its fill runs; that
  // flag (and retry's, before its response lands) is a busy signal too,
  // but the label stays fixed — never the server's text.
  const serverWorking =
    (expansion.working ?? body.working ?? "") !== "" && (expansion.working ?? body.working) !== null;
  const showWorking = !!busy || serverWorking;
  const workingLabel = busy?.label ?? "Working…";
  const errorText = expansion.error ?? body.error ?? null;
  const noAgent = isNoAgentMessage(errorText);

  const depthIndex = DEPTH_ORDER.indexOf(body.level as Depth);
  const safeDepthIndex = depthIndex < 0 ? 1 : depthIndex;
  const undoEnabled = (body.undoStack?.length ?? 0) > 0;

  const run = (action: Parameters<typeof performAction>[1]): void => {
    void performAction(reviewId, action).catch((err: unknown) => {
      if (isNoAgentError(err)) toast(NO_AGENT_COPY);
      else toast(`Couldn't do that: ${friendlyError(err)}`);
    });
  };

  const onRetry = (): void => {
    // Retry rebuilds the failed fill on the same annotation id (in-flight
    // through `performAction` so the card shows it immediately). When the
    // service has no retryable failure, fall back to re-explaining the
    // same quote so the button still recovers.
    void performAction(reviewId, { kind: "retry", threadId: expansion.id }, { toast: false }).catch((err: unknown) => {
      if (isNoAgentError(err)) {
        toast(NO_AGENT_COPY);
        return;
      }
      void performAction(reviewId, {
        kind: "explain",
        quote: expansion.anchor.quotedText,
        anchor: toActionAnchor(expansion),
      }).catch((e2: unknown) => {
        if (isNoAgentError(e2)) toast(NO_AGENT_COPY);
        else toast(`Couldn't retry: ${friendlyError(e2)}`);
      });
    });
  };

  const onPromote = (): void => {
    void api
      .action(reviewId, { kind: "promote", annotationId: expansion.id })
      .then((res) => {
        if (res.accepted && res.pageId) onOpenPage(res.pageId);
        else if (!res.accepted) toast("Not available with mock data");
      })
      .catch((err: unknown) => {
        toast(`Couldn't open as a page: ${friendlyError(err)}`);
      });
  };

  const onDelete = (): void => {
    void api
      .action(reviewId, { kind: "delete", targetId: expansion.id })
      .catch((err: unknown) => {
        toast(`Couldn't delete the explanation: ${friendlyError(err)}`);
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
          {stale ? <span className="hint">from an earlier wording</span> : null}
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
  const controlsBusy = busy !== null;
  const busyKind = busy?.kind;
  const depthBusy = busyKind === "depth";

  return (
    <section
      className={`card child${body.read ? " read" : ""}${busy?.rewriting ? " rewriting" : ""}`}
      id={`B-${expansion.id}`}
      data-expansion={expansion.id}
      aria-busy={busy ? true : undefined}
    >
      <div className="exp-h">
        {expansion.anchor.quotedText ? <q>{expansion.anchor.quotedText}</q> : null}
        {stale ? <span className="hint">from an earlier wording</span> : null}
        <span className="sp" />
        <ControlButton icon="open" label="Open as page" onClick={onPromote} />
        <ControlButton icon="trash" label="Delete" onClick={onDelete} />
        <ControlButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className="ctl">
        <span className="depth" role="group" aria-label="Depth" aria-busy={depthBusy || undefined}>
          <button
            type="button"
            data-tip="Simpler"
            aria-label={depthBusy ? "Working…" : "Simpler"}
            disabled={safeDepthIndex <= 0 || controlsBusy}
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
            data-tip={depthBusy ? "Working…" : "Deeper"}
            aria-label={depthBusy ? "Working…" : "Deeper"}
            disabled={controlsBusy}
            onClick={() => run({ kind: "depth", cardId: expansion.id, direction: "deeper" })}
          >
            {depthBusy ? (
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : (
              "+"
            )}
          </button>
        </span>
        <ControlButton
          icon="bulb"
          label="Use examples"
          busy={busyKind === "examples"}
          disabled={controlsBusy}
          onClick={() => performInsertAction(reviewId, expansion.id, "examples")}
        />
        <ControlButton
          icon="diagram"
          label="Add diagram"
          busy={busyKind === "diagram"}
          disabled={controlsBusy}
          onClick={() => performInsertAction(reviewId, expansion.id, "diagram")}
        />
        <ControlButton
          icon="undo"
          label="Undo"
          disabled={!undoEnabled || controlsBusy}
          onClick={() => run({ kind: "undo", cardId: expansion.id })}
        />
        <ExpansionSecondOpinion
          reviewId={reviewId}
          expansion={expansion}
          lookupPage={lookupPage}
          disabled={controlsBusy}
          busy={busyKind === "second_opinion"}
        />
        <span className="sp" />
        <ControlButton
          icon="check"
          label={body.read ? "Mark unread" : "Mark read"}
          pressed={body.read}
          onClick={() => run({ kind: "read", cardId: expansion.id, read: !body.read })}
        />
      </div>
      {showWorking && !errorText ? <Working text={workingLabel} /> : null}
      {noAgent ? (
        <div className="perr" role="status">
          <span>{NO_AGENT_COPY}</span>
        </div>
      ) : null}
      {errorText && !noAgent ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer: {errorText}</span>
          <button
            className="btn"
            type="button"
            data-retry={expansion.id}
            disabled={controlsBusy}
            aria-busy={busy ? true : undefined}
            onClick={onRetry}
          >
            {busy ? "Retrying…" : "Retry"}
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
              cardId={expansion.id}
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
  disabled,
  busy,
}: {
  reviewId: string;
  expansion: Annotation;
  lookupPage: (pageId: string) => Page | undefined;
  disabled?: boolean;
  busy?: boolean;
}) {
  // Expansions reuse the card control with the annotation id as cardId; the
  // service resolves expansion targets (M4 fix) and stores the result on the
  // expansion body so depth/undo leave it attached.
  void lookupPage;
  return (
    <SecondOpinionControl
      reviewId={reviewId}
      card={{ id: expansion.id } as never}
      page={undefined}
      disabled={disabled}
      busy={busy}
    />
  );
}
