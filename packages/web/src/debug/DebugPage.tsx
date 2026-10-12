/**
 * Per-review shared-context debug page (`/review/:id/debug`, issue #32,
 * PRD §9): the review's shared context as a rendered Markdown document —
 * base, log, contributions — with no formatting beyond Markdown rendering
 * and plain section headings.
 *
 * Served by `GET /api/reviews/:id/shared-context` (three Markdown strings
 * rendered as-is through `MarkdownView`). Delete keeps working through the
 * existing `DELETE /api/reviews/:id/contributions/:id` endpoint, with one
 * plain text button per contribution (existing `x`-style class, no new
 * CSS); the buttons read their ids from the structured contributions fetch
 * so the document itself stays pure Markdown.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Contribution, SharedContextResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ExpandedPrompts } from "./ExpandedPrompts.js";
import { JobsSection } from "./JobsSection.js";
import { MarkdownView } from "./MarkdownView.js";

export function DebugPageRoute(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <DebugPage reviewId={id ?? "demo"} />;
}

export function DebugPage({ reviewId }: { reviewId: string }): React.JSX.Element {
  const [doc, setDoc] = useState<SharedContextResponse | null>(null);
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [shared, contribs] = await Promise.all([
        api.sharedContext(reviewId),
        api.contributions(reviewId),
      ]);
      setDoc(shared);
      setItems(contribs.contributions);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [reviewId]);

  useEffect(() => {
    setDoc(null);
    setItems(null);
    void load();
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteContribution(reviewId, id);
      setItems((prev) => (prev === null ? prev : prev.filter((c) => c.id !== id)));
      // Re-render the document so the deleted contribution leaves it too.
      setDoc(await api.sharedContext(reviewId));
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="app">
      <header className="top">
        <Link className="brand" to="/" title="Back to the start screen">
          Unvibe
        </Link>
        <div className="pr">
          <b>Debug</b>
        </div>
        <Link className="tbtn" to={`/review/${reviewId}`}>
          Back to review
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <div className="eyebrow">Review debug</div>
          <h1 className="title">Jobs, prompts and shared context</h1>
          <p className="hint">
            Per-review jobs, the expanded prompt text for this review, then the shared context from
            PRD §9 that every agent conversation starts from: the base session, the append-only log,
            and the contributions.
          </p>
          {error ? (
            <p className="err" role="alert">
              Couldn&apos;t load shared context: {error}
            </p>
          ) : null}
          {!doc && !error ? <p className="hint">Loading shared context…</p> : null}
          <JobsSection reviewId={reviewId} />
          <ExpandedPrompts reviewId={reviewId} />
          {doc ? (
            <>
              <section aria-label="Base">
                <div className="divider">Base</div>
                <MarkdownView markdown={doc.base} />
              </section>
              <section aria-label="Log">
                <div className="divider">Log</div>
                <MarkdownView markdown={doc.log} />
              </section>
              <section aria-label="Contributions">
                <div className="divider">Contributions</div>
                <MarkdownView markdown={doc.contributions} />
                {items !== null && items.length > 0 ? (
                  <div>
                    {items.map((c) => (
                      <div className="frow" key={c.id} data-testid={`debug-delete-${c.id}`}>
                        <code className="hint">{c.id}</code>
                        <span className="sp" />
                        <button
                          className="x"
                          type="button"
                          aria-label={`Delete ${c.id}`}
                          onClick={() => void remove(c.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
