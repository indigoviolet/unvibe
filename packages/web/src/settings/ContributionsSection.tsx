/**
 * Shared context (PRD §4.14, §9.5): every automatic contribution — its
 * kind (fact, correction, open question, reader note), citations, the
 * thread it came from (click jumps there), status — and Delete for any
 * item. Served by `GET/DELETE /api/reviews/:id/contributions` (M8
 * contract in `@unvibe/shared`).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Contribution, ContributionItem } from "@unvibe/shared";
import { api } from "../api/client.js";

export function ContributionsSection({ reviewId }: { reviewId: string | null }): React.JSX.Element {
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reviewId) return;
    setError(null);
    try {
      setItems((await api.contributions(reviewId)).contributions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reviewId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    if (!reviewId) return;
    try {
      await api.deleteContribution(reviewId, id);
      setItems((prev) => (prev === null ? prev : prev.filter((c) => c.id !== id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section aria-label="Shared context">
      <div className="divider">Shared context</div>
      {!reviewId ? (
        <p className="hint">Open settings from a review (`/settings?review=:id`) to see its shared context.</p>
      ) : error ? (
        <p className="err">{error}</p>
      ) : items === null ? (
        <p className="hint">Loading contributions…</p>
      ) : items.length === 0 ? (
        <p className="hint">No contributions yet. Agent turns append facts, corrections, open questions and reader notes here.</p>
      ) : (
        items.map((c) => (
          <ContributionCard key={c.id} contribution={c} reviewId={reviewId} onDelete={() => void remove(c.id)} />
        ))
      )}
    </section>
  );
}

function ContributionCard({
  contribution,
  reviewId,
  onDelete,
}: {
  contribution: Contribution;
  reviewId: string;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="card" style={{ padding: "8px 14px" }} data-testid={`contribution-${contribution.id}`}>
      <div className="frow" style={{ gap: 8 }}>
        <code className="hint">{contribution.id}</code>
        <span className={`st ${contribution.status}`}>{contribution.status}</span>
        <span className="hint">from {contribution.sourceSession}</span>
        {contribution.replaces ? <span className="hint">replaces {contribution.replaces}</span> : null}
        <span className="sp" />
        <button className="x" type="button" aria-label={`Delete ${contribution.id}`} onClick={onDelete}>
          Delete
        </button>
      </div>
      {contribution.items.map((item, i) => (
        <ContributionItemView key={i} item={item} reviewId={reviewId} sourceSession={contribution.sourceSession} />
      ))}
    </div>
  );
}

function ContributionItemView({
  item,
  reviewId,
  sourceSession,
}: {
  item: ContributionItem;
  reviewId: string;
  sourceSession: string;
}): React.JSX.Element {
  return (
    <div style={{ margin: "6px 0" }}>
      <div className="frow" style={{ gap: 8 }}>
        <span className="st">{kindLabel(item.kind)}</span>
        <span className="sp" />
        <ThreadLink reviewId={reviewId} sourceSession={sourceSession} target={item.target} />
      </div>
      <p style={{ margin: "4px 0" }}>{item.text}</p>
      {item.target && !isCardTarget(item.target) ? <p className="hint">target: {item.target}</p> : null}
      {item.citations.length > 0 ? (
        <p className="hint" style={{ margin: "2px 0" }}>
          cites: {item.citations.map((c) => c.target).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function kindLabel(kind: ContributionItem["kind"]): string {
  switch (kind) {
    case "fact":
      return "fact";
    case "correction":
      return "correction";
    case "open_question":
      return "open question";
    case "reader_note":
      return "reader note";
  }
}

function isCardTarget(target: string): boolean {
  return target.startsWith("card:");
}

/**
 * The thread an item came from, clickable to jump there: corrections carry
 * a `card:<id>#<block>` target (the review page scrolls to `#C-<card>`);
 * otherwise the source session names the thread — it opens the review
 * where the comments menu lists every thread.
 */
function ThreadLink({
  reviewId,
  sourceSession,
  target,
}: {
  reviewId: string;
  sourceSession: string;
  target: string | undefined;
}): React.JSX.Element | null {
  if (target && isCardTarget(target)) {
    const cardId = target.slice("card:".length).split("#")[0];
    return (
      <Link className="x" to={`/review/${reviewId}#C-${cardId}`}>
        Open card
      </Link>
    );
  }
  if (sourceSession.startsWith("t-") || sourceSession.startsWith("ann_")) {
    return (
      <Link className="x" to={`/review/${reviewId}`}>
        Open thread {sourceSession}
      </Link>
    );
  }
  return null;
}
