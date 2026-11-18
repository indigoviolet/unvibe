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
import type { Card } from "@unvibe/shared";
import { hasNewCommits, sinceBaselineLabel } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { Button } from "../ui/index.js";
import { SinceBaselineError } from "./PriorReviewOffer.js";
import { defaultExplainX, entriesHave, ExplainXSelect, explainXLabel, useExplainEntries, type ExplainX } from "./ExplainXSelect.js";
import { useExplainPass } from "./useExplainPass.js";

export function sinceDate(at: number): string {
  const d = new Date(at);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
}

/**
 * Explain control for the guide side (#413): one row of the X picker
 * and the "Explain changes" button. The X shows in one place only —
 * the picker (or, in the section header, the header text) — never
 * repeated on the button. A default X is preselected in the picker as
 * a real choice; with nothing armed the button is disabled and its
 * tooltip says why.
 */
function ExplainControl({
  reviewId,
  placeholder,
  preselectDefault,
}: {
  reviewId: string;
  placeholder: string;
  /** First run only: the section header already names its X. */
  preselectDefault: boolean;
}) {
  // The first-run row says what the button does; in the section header
  // the picker already reads "Explain from another point…", so the
  // button is just "Explain" (never the same words twice on screen).
  const action = preselectDefault ? "Explain changes" : "Explain";
  const [x, setX] = useState<ExplainX | null>(null);
  const snapshot = useReview((s) => s.snapshot);
  const entries = useExplainEntries(reviewId);
  const { phase, start } = useExplainPass(reviewId, () => {});
  const def = snapshot ? defaultExplainX(snapshot) : null;
  const armed = x ?? (preselectDefault && def && entriesHave(entries, def) ? def : null);
  const label = armed ? explainXLabel(armed) : null;
  if (phase.name === "explaining") {
    return (
      <span className="hint" data-testid="explain-progress" aria-live="polite" role="status">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>{" "}
        Explaining changes since {label ?? "…"}…
      </span>
    );
  }
  const why = "Pick a version, commit or review to explain from";
  return (
    <>
      <span className="explain-row">
        <ExplainXSelect reviewId={reviewId} value={armed} onChange={setX} placeholder={placeholder} />
        <Button
          variant="primary"
          type="button"
          data-testid="explain-button"
          disabled={!armed}
          data-tip={armed ? undefined : why}
          title={armed ? undefined : why}
          onClick={() => armed && start(armed)}
        >
          {action}
        </Button>
      </span>
      {phase.name === "failed" ? (
        <span className="hint explain-error" role="alert" data-testid="explain-error">
          {phase.message}
        </span>
      ) : null}
      {phase.name === "empty" ? (
        <span className="hint explain-note" role="status" data-testid="explain-empty">
          No changes to explain since {label}
        </span>
      ) : null}
    </>
  );
}

/**
 * The persistent guide-side Explain entry (#413: Explain is offered any
 * time, not only after new commits). Renders when no Changes-since-X
 * section exists yet — the section header carries the control once it
 * does — and only when there is something earlier to explain from (an
 * earlier version, a non-head commit or a prior GitHub review).
 */
export function ExplainControlSlot({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  const entries = useExplainEntries(reviewId);
  if (!snapshot) return null;
  if ((snapshot.sinceSection?.cards.length ?? 0) > 0) return null;
  // The new-commits banner (Source pane) already offers Explain; the
  // guide side stays quiet then so the offer reads as one.
  if (hasNewCommits(snapshot.versionStatus)) return null;
  // Nothing earlier than the head: no row at all, never a picker with
  // nothing valid in it.
  if (entries.length === 0) return null;
  return (
    <section className="since" aria-label="Explain changes" data-testid="explain-control">
      <div className="since-h">
        <ExplainControl reviewId={reviewId} placeholder="Explain changes since…" preselectDefault />
      </div>
      <SinceBaselineError />
    </section>
  );
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
          Changes since {label} → v{since.headVersion} · {sinceDate(since.at)}
        </Button>
        <span className="sp" />
        <ExplainControl reviewId={reviewId} placeholder="Explain from another point…" preselectDefault={false} />
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
