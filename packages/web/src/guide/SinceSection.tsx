/**
 * The dated Since-B section (issue #351 step 1): the top of the guide
 * after an update pass. Dated, collapsible, replaced whole on the next
 * pass — never revised in place. Its cards explain the delta: what
 * changed, why (from the new commits' messages), and the feedback that
 * caused each change, cited into the new hunks. The header carries the
 * baseline picker, so any earlier version can be B for the next update.
 */
import { useState, type ReactNode } from "react";
import type { Card, Review } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { Badge, Button, Card as UiCard } from "../ui/index.js";
import { SinceBaselinePicker } from "./SinceBaselinePicker.js";

export function sinceDate(at: number): string {
  const d = new Date(at);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
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
  const changedTotal = snapshot?.sinceHunks
    ? snapshot.sinceHunks.added.length + snapshot.sinceHunks.changed.length
    : 0;

  return (
    <UiCard as="section" variant="raised" className="since" aria-label="Since baseline" data-testid="since-section">
      <div className="since-h">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse Since-B section" : "Expand Since-B section"}
          data-testid="since-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "down" : "right"} />
          Since v{since.baseline} → v{since.headVersion} · {sinceDate(since.at)}
        </Button>
        <span className="sp" />
        {changedTotal > 0 ? <Badge tone="outline">{changedTotal} hunks</Badge> : null}
        <SinceBaselinePicker reviewId={reviewId} review={review} />
      </div>
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
