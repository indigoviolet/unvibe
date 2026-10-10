/**
 * Card rendering (M2, web-guide owner; PRD §4.4 display side).
 *
 * Collapse chevron (collapsed shows the title row, or the first line if
 * untitled); control row (depth stepper with three dots, Use examples,
 * Add diagram, Undo, Mark read) wired to `POST /api/reviews/:id/actions`
 * via `performAction`; read greys and collapses; "Go deeper" placeholder
 * cards with Generate showing job progress; working dots whenever a job
 * runs for the card.
 */
import type { Card, DepthLevel, Job, Page } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { performAction } from "./actions.js";
import { blockThreads } from "./annotations.js";
import { BlockView } from "./BlockView.js";
import { cardPreview } from "./guideUtils.js";

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
      title={label}
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

/** The running/queued job for a card, if any (PRD §4.4 pending state). */
export function jobForCard(jobs: Job[], cardId: string): Job | undefined {
  return jobs.find(
    (j) => j.cardId === cardId && (j.state === "running" || j.state === "queued"),
  );
}

export function CardView({ reviewId, card, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const jobs = snapshot?.jobs ?? [];
  const annotations = snapshot?.annotations ?? [];
  const job = jobForCard(jobs, card.id);

  if (card.pending) {
    return (
      <section className="card pend" id={`C-${card.id}`}>
        {job ? (
          <Working text={job.progress ?? "Working…"} />
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
  const threadsFor = (blockId: string): ReturnType<typeof blockThreads> =>
    blockThreads(annotations, blockId);

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
      <div className="ctl">
        <span className="depth" role="group" aria-label="Depth">
          <button
            type="button"
            title="Simpler"
            aria-label="Simpler"
            disabled={depthIndex <= 0}
            onClick={() =>
              void performAction(reviewId, { kind: "depth", cardId: card.id, direction: "simpler" })
            }
          >
            −
          </button>
          <span className="dl" title="Depth">
            <span className="pips" aria-hidden="true">
              {DEPTH_ORDER.map((_, j) => (
                <i key={j} className={j <= depthIndex ? "on" : ""} />
              ))}
            </span>
          </span>
          <button
            type="button"
            title="Deeper"
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
      {job ? <Working text={job.progress ?? "Working…"} /> : null}
      {card.blocks.map((block) => (
        <BlockView
          key={block.id}
          block={block}
          level={card.level}
          threads={threadsFor(block.id)}
          lookupPage={lookupPage}
          onOpenPage={onOpenPage}
          onFollowUp={(blockId, index) => onFollowUp(card.id, blockId, index)}
        />
      ))}
    </section>
  );
}
