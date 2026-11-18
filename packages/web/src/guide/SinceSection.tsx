/**
 * The Changes section (issue #413, panel #421): the top of the guide
 * after an Explain run. One grouped panel (a light `--sunk` inset box
 * matching the guide's Contents box), the commit-range header at the
 * top and the cards inside. Collapsing folds the whole panel to its
 * header. Replaced whole on the next run — never revised in place. Its
 * cards explain the delta: what changed, why (from the commits'
 * messages), and the feedback that caused each change, cited into the
 * X→head hunks. A re-run from the menu replaces this panel whole.
 */
import { useState, type ReactNode } from "react";
import type { Card } from "@unvibe/shared";
import { newerCommitsSince } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { Card as UiCard } from "../ui/index.js";
import { SinceBaselineError } from "./PriorReviewOffer.js";

export function sinceDate(at: number): string {
  const d = new Date(at);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
}

export function SinceSection({
  reviewId,
  renderCard,
}: {
  reviewId: string;
  renderCard: (card: Card) => ReactNode;
}) {
  const snapshot = useReview((s) => s.snapshot);
  const since = snapshot?.sinceSection;
  const [open, setOpen] = useState(true);
  if (!since || since.cards.length === 0) return null;

  // The header names the commit range the run explained: `from` is the
  // baseline commit (a version baseline resolves through its stored
  // head), `to` is the head the section was written at. No versions.
  const baseline = since.baseline;
  const fromSha =
    baseline.kind === "commit"
      ? baseline.sha
      : (
          snapshot?.review.versions.find((v) => v.n === baseline.version)?.headSha ??
          snapshot?.version.headSha ??
          ""
        );
  const from = fromSha.slice(0, 8);
  const to = since.headSha.slice(0, 8);
  const range = `${from} → ${to}`;
  const date = sinceDate(since.at);
  // A quiet note when the PR moved on past the head this was written
  // at. Unresolvable after a rewrite (the old head is gone from the
  // commit list) hides the note rather than guessing.
  const newer =
    snapshot?.commits !== undefined ? newerCommitsSince(snapshot.commits, since.headSha) : null;

  return (
    <UiCard
      as="section"
      variant="inset"
      className="since-panel"
      aria-label={`Changes ${range}`}
      data-testid="since-section"
      data-since-section=""
    >
      <div className="since-h">
        <button
          className="ib"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse changes ${range}` : `Expand changes ${range}`}
          data-testid="since-toggle"
          data-tip={open ? "Hide changes" : "Show changes"}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "down" : "right"} />
        </button>
        <span className="since-title">
          Changes {range} · {date}
        </span>
        {newer !== null && newer > 0 ? (
          <span className="hint" data-testid="since-newer">
            {newer === 1 ? "1 newer commit since this was written" : `${newer} newer commits since this was written`}
          </span>
        ) : null}
      </div>
      <SinceBaselineError />
      {open ? (
        <div className="since-cards">
          {since.cards.map((card) => (
            <div key={card.id}>{renderCard(card)}</div>
          ))}
        </div>
      ) : null}
    </UiCard>
  );
}
