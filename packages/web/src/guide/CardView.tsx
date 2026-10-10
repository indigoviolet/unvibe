/**
 * Card rendering (web-guide owner; PRD §4.4 display side + §8 stale state).
 *
 * Collapse chevron (collapsed shows the title row, or the first line if
 * untitled); control row (depth stepper with three dots, Use examples,
 * Add diagram, Undo, Second opinion with blind/check switch, Mark read)
 * wired to `POST /api/reviews/:id/actions`; read greys and collapses;
 * stale cards show the cited-hunks count with an Update button
 * (`POST /api/reviews/:id/update`); "Go deeper" placeholder cards with
 * Generate showing job progress; working dots whenever a job runs for the
 * card or streamed text arrives for it. Second-opinion results render
 * attached below the blocks (PRD §4.10; owned by the second-opinion
 * milestone, additive here).
 */
import type { Annotation, Card, DepthLevel, Page } from "@unvibe/shared";
import { Fragment } from "react";
import { GuideBlockThreads } from "../comments/GuideThreads.js";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { performAction, performUpdate } from "./actions.js";
import { blockExpansions, blockThreads } from "./annotations.js";
import { BlockView } from "./BlockView.js";
import { cardPreview, jobForCard } from "./guideUtils.js";
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
}: {
  icon: "down" | "right" | "check" | "bulb" | "diagram" | "undo";
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

/** Rendered content of an open expansion with something to show. */
function ExpansionCard({ expansion }: { expansion: Annotation }) {
  const html = expansion.messages
    .map((m) => m.html ?? (m.text ? `<p>${m.text.replace(/</g, "&lt;")}</p>` : ""))
    .join("");
  if (!html.trim()) return null;
  return (
    <section className="card child" id={`B-${expansion.id}`}>
      <div className="exp-h">
        {expansion.anchor.quotedText ? <q>{expansion.anchor.quotedText}</q> : null}
      </div>
      <div className="exp-b" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

export function CardView({ reviewId, card, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const jobs = snapshot?.jobs ?? [];
  const annotations = snapshot?.annotations ?? [];
  const streams = useReview((s) => s.streams);
  const job = jobForCard(jobs, card.id);
  const streamText = streams[card.id];
  const progress = job?.progress ?? (streamText ? streamText.slice(-160) : undefined);

  if (card.pending) {
    return (
      <section className="card pend" id={`C-${card.id}`}>
        {job || streamText ? (
          <Working text={progress ?? "Working…"} />
        ) : (
          <>
            <div className="pl">{card.pending.label}</div>
            <div className="why">{card.pending.why}</div>
            <button
              className="go"
              type="button"
              data-gen={card.id}
              onClick={() => void performAction(reviewId, { kind: "generate", cardId: card.id })}
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
  const expansionsFor = (blockId: string): Annotation[] =>
    blockExpansions(annotations, card.id, blockId);

  const blocks = card.blocks.map((block) => (
    // Fragment (not a div): prototype.css child selectors (`.card.read > …`)
    // depend on blocks being direct children of the section.
    <Fragment key={block.id}>
      <BlockView
        block={block}
        level={card.level}
        threads={threadsFor(block.id)}
        lookupPage={lookupPage}
        onOpenPage={onOpenPage}
        onFollowUp={(blockId, index) => onFollowUp(card.id, blockId, index)}
      />
      <GuideBlockThreads reviewId={reviewId} cardId={card.id} blockId={block.id} />
      {expansionsFor(block.id).map((e) => (
        <ExpansionCard key={e.id} expansion={e} />
      ))}
    </Fragment>
  ));

  if (card.collapsed) {
    return (
      <section className={`card collapsed${card.read ? " read" : ""}`} id={`C-${card.id}`}>
        <div className="chead">
          <ControlButton
            icon="right"
            label="Expand"
            onClick={() =>
              void performAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: false })
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
                void performAction(reviewId, { kind: "read", cardId: card.id, read: false })
              }
            />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`card${card.read ? " read" : ""}`} id={`C-${card.id}`}>
      <div className="chead">
        <ControlButton
          icon="down"
          label="Collapse"
          onClick={() =>
            void performAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: true })
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
          <button className="x" type="button" onClick={() => performUpdate(reviewId)}>
            Update
          </button>
        </div>
      ) : null}
      <div className="ctl">
        <span className="depth" role="group" aria-label="Depth">
          <button
            type="button"
            data-tip="Simpler"
            aria-label="Simpler"
            disabled={depthIndex <= 0}
            onClick={() =>
              void performAction(reviewId, { kind: "depth", cardId: card.id, direction: "simpler" })
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
            data-tip="Deeper"
            aria-label="Deeper"
            onClick={() =>
              void performAction(reviewId, { kind: "depth", cardId: card.id, direction: "deeper" })
            }
          >
            +
          </button>
        </span>
        <ControlButton
          icon="bulb"
          label="Use examples"
          onClick={() => void performAction(reviewId, { kind: "examples", cardId: card.id })}
        />
        <ControlButton
          icon="diagram"
          label="Add diagram"
          onClick={() => void performAction(reviewId, { kind: "diagram", cardId: card.id })}
        />
        <ControlButton
          icon="undo"
          label="Undo"
          disabled={card.undoStack.length === 0}
          onClick={() => void performAction(reviewId, { kind: "undo", cardId: card.id })}
        />
        <SecondOpinionControl reviewId={reviewId} card={card} page={lookupPage(card.pageId)} />
        <span className="sp" />
        <ControlButton
          icon="check"
          label={card.read ? "Mark unread" : "Mark read"}
          pressed={card.read}
          onClick={() =>
            void performAction(reviewId, { kind: "read", cardId: card.id, read: !card.read })
          }
        />
      </div>
      {job || streamText ? <Working text={progress ?? "Working…"} /> : null}
      {blocks}
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
