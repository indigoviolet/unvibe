/**
 * Second-opinion result block (PRD §4.10).
 *
 * Attached to the card (not part of its revisable content): model label,
 * verdict chip, reasoning with citation markers that behave like all
 * others (hover preview, click reveals via `BlockView`), "what the card
 * missed", re-run and remove controls. A disagreement uses the
 * prototype's warn colours prominently.
 */
import type { Thread, Card, Page, SecondOpinionResult } from "@unvibe/shared";
import { Icon } from "../../components/Icon.js";
import { useReview } from "../../state/store.js";
import { BlockView } from "../BlockView.js";
import { performAction } from "../actions.js";
import { Button } from "../../ui/index.js";

interface Props {
  reviewId: string;
  card: Card;
  result: SecondOpinionResult;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
}

function verdictLabel(v: SecondOpinionResult["verdict"]): string {
  if (v === "agrees") return "Agrees";
  if (v === "partly") return "Partly";
  return "Disagrees";
}

export function SecondOpinionBlock({ reviewId, card, result, lookupPage, onOpenPage, onFollowUp }: Props): React.JSX.Element {
  const threads: Thread[] = [];
  const dis = result.verdict === "disagrees";
  // A re-run starts an agent session for the same card: disable while one
  // is already in flight so it cannot be double-clicked.
  const cardBusy = !!useReview((s) => s.inflight[card.id]);
  return (
    <section
      className={`so${dis ? " so-dis" : ""}`}
      data-so={result.id}
      data-verdict={result.verdict}
      aria-label={`Second opinion (${result.verdict})`}
    >
      <div className="so-h">
        <span className="so-tag">Second opinion</span>
        <span className="so-model" title={`${result.provider}/${result.model}`}>
          {result.provider}/{result.model}
        </span>
        <span className={`so-verd so-${result.verdict}`} role="status">
          {verdictLabel(result.verdict)}
        </span>
        <span className="sp" />
        <Button
          variant="quiet"
          size="sm"
          type="button"
          data-tip="Re-run second opinion"
          aria-label={cardBusy ? "Working…" : `Re-run second opinion (${result.mode})`}
          aria-busy={cardBusy || undefined}
          disabled={cardBusy}
          onClick={() => void performAction(reviewId, { kind: "second_opinion", cardId: card.id, mode: result.mode })}
        >
          {cardBusy ? "Working…" : "Re-run"}
        </Button>
        <button
          className="ib"
          type="button"
          data-tip="Remove second opinion"
          aria-label="Remove second opinion"
          onClick={() =>
            void performAction(reviewId, {
              kind: "delete",
              targetId: `second-opinion:${card.id}:${result.mode}`,
            })
          }
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="so-b">
        {result.blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            level="standard"
            threads={threads}
            lookupPage={lookupPage}
            cardId={card.id}
            onOpenPage={onOpenPage}
            onFollowUp={(blockId, index) => onFollowUp(card.id, blockId, index)}
          />
        ))}
      </div>
      {result.missed ? (
        <p className="so-missed">
          <b>Missed: </b>
          {result.missed}
        </p>
      ) : null}
    </section>
  );
}
