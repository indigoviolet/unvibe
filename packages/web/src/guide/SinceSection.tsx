/**
 * The Changes-since-X section (issue #413): the top of the guide after
 * an Explain run. Dated, collapsible, replaced whole on the next run —
 * never revised in place. Its cards explain the delta: what changed,
 * why (from the commits' messages), and the feedback that caused each
 * change, cited into the X→head hunks. The header names the X the run
 * explained from, and carries the control for explaining from a
 * different X. A re-run replaces this section whole.
 */
import { useState, type ReactNode } from "react";
import type { Card, Review } from "@unvibe/shared";
import { hasNewCommits, sinceBaselineLabel } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { Button } from "../ui/index.js";
import { SinceBaselineError } from "./PriorReviewOffer.js";
import { defaultExplainX, ExplainXSelect, explainXLabel, type ExplainX } from "./ExplainXSelect.js";
import { useExplainPass } from "./useExplainPass.js";

export function sinceDate(at: number): string {
  const d = new Date(at);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
}

/**
 * Explain control for the guide side (#413): the X selector plus the
 * button, used both in the section header (re-run from a different X)
 * and, via `ExplainControl`, when no section exists yet.
 */
function ExplainControl({ reviewId }: { reviewId: string }) {
  const [x, setX] = useState<ExplainX | null>(null);
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const { phase, start } = useExplainPass(reviewId, () => {
    void api.review(reviewId).then(setSnapshot).catch(() => {});
  });
  const def = snapshot ? defaultExplainX(snapshot) : null;
  const label = explainXLabel(x ?? def ?? { version: 1 });
  if (phase.name === "explaining") {
    return (
      <span className="hint" data-testid="explain-progress" aria-live="polite" role="status">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>{" "}
        Explaining changes since {label}…
      </span>
    );
  }
  return (
    <span className="dbar-group">
      <ExplainXSelect reviewId={reviewId} value={x} onChange={setX} />
      <button className="x" type="button" onClick={() => start(x)}>
        Explain changes since {label}
      </button>
      {phase.name === "failed" ? <span className="hint" data-testid="explain-error">{phase.message}</span> : null}
    </span>
  );
}

/**
 * The persistent guide-side Explain entry (#413: Explain is offered any
 * time, not only after new commits). Renders when no Changes-since-X
 * section exists yet — the section header carries the control once it
 * does. Hidden while the review is still opening (no commits or
 * versions to choose X from render no selector anyway).
 */
export function ExplainControlSlot({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  if (!snapshot) return null;
  if ((snapshot.sinceSection?.cards.length ?? 0) > 0) return null;
  // The new-commits banner (Source pane) already offers Explain with
  // its own control; the guide side stays quiet then so the offer
  // reads as one. Otherwise the guide carries the entry point.
  if (hasNewCommits(snapshot.versionStatus)) return null;
  return (
    <section className="since" aria-label="Explain changes" data-testid="explain-control">
      <div className="since-h">
        <span className="hint">Explain what changed, and why:</span>
        <span className="sp" />
        <ExplainControl reviewId={reviewId} />
      </div>
      <SinceBaselineError />
    </section>
  );
}

export function SinceSection({
  reviewId,
  review,
  renderCard,
}: {
  reviewId: string;
  review: Review;
  renderCard: (card: Card) => ReactNode;
}) {
  const snapshot = useReview((s) => s.snapshot);
  const since = snapshot?.sinceSection;
  const [open, setOpen] = useState(true);
  if (!since || since.cards.length === 0) return null;

  // Plain header plus full-width cards — never a box holding cards
  // (prototype parity): the cards keep the normal guide width. The
  // header names the real X (version or short sha) the run explained
  // from, never "B".
  const label = sinceBaselineLabel(since.baseline);
  return (
    <section className="since" aria-label={`Changes since ${label}`} data-testid="since-section" data-since-section="">
      <div className="since-h">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse changes since ${label}` : `Expand changes since ${label}`}
          data-testid="since-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "down" : "right"} />
          Since {label} → v{since.headVersion} · {sinceDate(since.at)}
        </Button>
        <span className="sp" />
        <ExplainControl reviewId={reviewId} />
      </div>
      <SinceBaselineError />
      {open ? (
        <div className="since-cards">
          {since.cards.map((card) => (
            <div key={card.id}>{renderCard(card)}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
