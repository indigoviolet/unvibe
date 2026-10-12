/**
 * Card rendering (M4 interaction; PRD §4.4 display side + §8 stale state).
 *
 * Collapse chevron first (title row when collapsed); control row (depth
 * stepper with three dots, Use examples, Add diagram, Undo, Second opinion
 * with blind/check switch, Mark read) wired to
 * `POST /api/reviews/:id/actions`; read greys and collapses; stale cards
 * show the cited-hunks count with an Update button; "Go deeper"
 * placeholder cards with Generate showing a plain working state. Every
 * agent-starting control sets an in-flight entry on click (dots on the
 * clicked control, conflicting controls disabled, rewrite border or
 * placeholder); the entry hands over to the snapshot job once it appears.
 * Expansions render under their block via `ExpansionCard` (open ones in
 * place; closed ones as dotted-link highlights with a hidden fallback
 * stub); promoted links render as page-link stubs. Corrections show as
 * suggestions on the target card with Accept/Dismiss.
 */
import type { Annotation, Card, DepthLevel, Page } from "@unvibe/shared";
import { Fragment } from "react";
import { GuideBlockThreads } from "../comments/GuideThreads.js";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { performAction, performInsertAction, performUpdate } from "./actions.js";
import { blockThreads } from "./annotations.js";
import { BlockView } from "./BlockView.js";
import { CorrectionSuggestion } from "./expansions/CorrectionSuggestion.js";
import { ExpansionCard } from "./expansions/ExpansionCard.js";
import { expansionsForBlock } from "./expansions/ExpansionHighlights.js";
import { isClosedExpansion, isOpenExpansion, isPromotedLink } from "./expansions/expansionUtils.js";
import { cardPreview } from "./guideUtils.js";
import { busyForCard, updateKey } from "./inflight.js";
import { SecondOpinionBlock, SecondOpinionControl } from "./secondOpinion/index.js";

const DEPTH_ORDER: DepthLevel[] = ["simple", "standard", "deep"];

interface Props {
  reviewId: string;
  card: Card;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
}

function ControlButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  busy,
}: {
  icon: "down" | "right" | "check" | "bulb" | "diagram" | "undo";
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
export function Working({ text }: { text: string }) {
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

function runCardAction(reviewId: string, action: Parameters<typeof performAction>[1]): void {
  // performAction toasts + resyncs on failure; swallow here so callers stay
  // fire-and-forget without double toasts.
  void performAction(reviewId, action).catch(() => {});
}



export function CardView({ reviewId, card, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const jobs = snapshot?.jobs ?? [];
  const annotations = snapshot?.annotations ?? [];
  const inflight = useReview((s) => s.inflight);
  const contributions = snapshot?.contributions ?? [];
  const busy = busyForCard(inflight, jobs, card.id);
  const busyKind = busy?.kind;

  if (card.pending) {
    return (
      <section className="card pend" id={`C-${card.id}`} aria-busy={busy ? true : undefined}>
        {busy ? (
          <Working text={busy.label} />
        ) : (
          <>
            <div className="pl">{card.pending.label}</div>
            <div className="why">{card.pending.why}</div>
            <button
              className="go"
              type="button"
              data-gen={card.id}
              onClick={() => runCardAction(reviewId, { kind: "generate", cardId: card.id })}
            >
              Generate
            </button>
          </>
        )}
      </section>
    );
  }

  const depthIndex = DEPTH_ORDER.indexOf(card.level);
  const threadsFor = (blockId: string): Annotation[] =>
    blockThreads(annotations, card.id, blockId);

  const blocks = card.blocks.map((block) => {
    const exps = expansionsForBlock(annotations, card.id, block.id);
    const open = exps.filter(isOpenExpansion);
    const closed = exps.filter(isClosedExpansion);
    const links = exps.filter(isPromotedLink);
    return (
      // Fragment (not a div): prototype.css child selectors (`.card.read > …`)
      // depend on blocks being direct children of the section.
      <Fragment key={block.id}>
        <BlockView
          block={block}
          level={card.level}
          threads={threadsFor(block.id)}
          lookupPage={lookupPage}
          cardId={card.id}
          onOpenPage={onOpenPage}
          onFollowUp={(blockId, index) => onFollowUp(card.id, blockId, index)}
        />
        <GuideBlockThreads reviewId={reviewId} cardId={card.id} blockId={block.id} />
        {open.map((e) => (
          <ExpansionCard
            key={e.id}
            reviewId={reviewId}
            expansion={e}
            lookupPage={lookupPage}
            onOpenPage={onOpenPage}
            onFollowUp={onFollowUp}
          />
        ))}
        {closed.map((e) => (
          <div key={e.id} className="linkstub" data-fallback={e.id} hidden>
            ↳{" "}
            <button
              type="button"
              onClick={() =>
                runCardAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: false })
              }
            >
              {e.anchor.quotedText || "Show explanation"}
            </button>
            <span className="hint">click the dotted link to expand</span>
          </div>
        ))}
        {links.map((e) => (
          <div key={e.id} className="linkstub" data-fallback={e.id} hidden>
            ↳{" "}
            <button
              type="button"
              data-node={e.promotedToPage ?? ""}
              onClick={() => e.promotedToPage && onOpenPage(e.promotedToPage)}
            >
              {e.anchor.quotedText || "Opened as its own page"}
            </button>
            <span className="hint">opened as its own page</span>
          </div>
        ))}
      </Fragment>
    );
  });

  if (card.collapsed) {
    return (
      <section className={`card collapsed${card.read ? " read" : ""}`} id={`C-${card.id}`}>
        <div className="chead">
          <ControlButton
            icon="right"
            label="Expand"
            onClick={() =>
              runCardAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: false })
            }
          />
          {card.title ? (
            <h2 className="ct">{card.title}</h2>
          ) : (
            <p className="cprev">{cardPreview(card)}</p>
          )}
          {card.read ? (
            <ControlButton
              icon="check"
              label="Mark unread"
              pressed
              onClick={() =>
                runCardAction(reviewId, { kind: "read", cardId: card.id, read: false })
              }
            />
          ) : null}
        </div>
      </section>
    );
  }

  // While an agent action runs for this card, the conflicting controls go
  // disabled and the clicked one shows dots in place of its icon.
  const controlsBusy = busy !== null;
  const depthBusy = busyKind === "depth";
  const examplesBusy = busyKind === "examples";
  const diagramBusy = busyKind === "diagram";
  const secondOpinionBusy = busyKind === "second_opinion";

  return (
    <section
      className={`card${card.read ? " read" : ""}${busy?.rewriting ? " rewriting" : ""}`}
      id={`C-${card.id}`}
      aria-busy={busy ? true : undefined}
    >
      <div className="chead">
        <ControlButton
          icon="down"
          label="Collapse"
          onClick={() =>
            runCardAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: true })
          }
        />
        {card.title ? <h2 className="ct">{card.title}</h2> : null}
      </div>
      {card.stale ? (
        <div className="stale" role="status">
          <span>
            {card.staleChangedHunks ?? 0} cited{" "}
            {(card.staleChangedHunks ?? 0) === 1 ? "hunk" : "hunks"} changed
          </span>
          <button
            className="x"
            type="button"
            disabled={!!inflight[updateKey(reviewId)]}
            aria-busy={inflight[updateKey(reviewId)] ? true : undefined}
            onClick={() => performUpdate(reviewId)}
          >
            {inflight[updateKey(reviewId)] ? "Updating…" : "Update"}
          </button>
        </div>
      ) : null}
      <div className="ctl">
        <span className="depth" role="group" aria-label="Depth" aria-busy={depthBusy || undefined}>
          <button
            type="button"
            data-tip="Simpler"
            aria-label={depthBusy ? "Working…" : "Simpler"}
            disabled={depthIndex <= 0 || controlsBusy}
            onClick={() =>
              runCardAction(reviewId, { kind: "depth", cardId: card.id, direction: "simpler" })
            }
          >
            −
          </button>
          <span className="dl" data-tip="Depth">
            <span className="pips" aria-hidden="true">
              {DEPTH_ORDER.map((_, j) => (
                <i key={j} className={j <= depthIndex ? "on" : ""} />
              ))}
            </span>
          </span>
          <button
            type="button"
            data-tip={depthBusy ? "Working…" : "Deeper"}
            aria-label={depthBusy ? "Working…" : "Deeper"}
            disabled={controlsBusy}
            onClick={() =>
              runCardAction(reviewId, { kind: "depth", cardId: card.id, direction: "deeper" })
            }
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
          busy={examplesBusy}
          disabled={controlsBusy}
          onClick={() => performInsertAction(reviewId, card.id, "examples")}
        />
        <ControlButton
          icon="diagram"
          label="Add diagram"
          busy={diagramBusy}
          disabled={controlsBusy}
          onClick={() => performInsertAction(reviewId, card.id, "diagram")}
        />
        <ControlButton
          icon="undo"
          label="Undo"
          disabled={card.undoStack.length === 0 || controlsBusy}
          onClick={() => runCardAction(reviewId, { kind: "undo", cardId: card.id })}
        />
        <SecondOpinionControl
          reviewId={reviewId}
          card={card}
          page={lookupPage(card.pageId)}
          disabled={controlsBusy}
          busy={secondOpinionBusy}
        />
        <span className="sp" />
        <ControlButton
          icon="check"
          label={card.read ? "Mark unread" : "Mark read"}
          pressed={card.read}
          onClick={() =>
            runCardAction(reviewId, { kind: "read", cardId: card.id, read: !card.read })
          }
        />
      </div>
      {busy ? <Working text={busy.label} /> : null}
      {blocks}
      <CorrectionSuggestion reviewId={reviewId} card={card} contributions={contributions} />
      {(card.secondOpinions ?? []).map((so) => (
        <SecondOpinionBlock
          key={so.id}
          reviewId={reviewId}
          card={card}
          result={so}
          lookupPage={lookupPage}
          onOpenPage={onOpenPage}
          onFollowUp={(cardId, blockId, index) => onFollowUp(cardId, blockId, index)}
        />
      ))}
    </section>
  );
}
