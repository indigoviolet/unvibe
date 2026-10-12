/**
 * Shared-context tab of the per-review debug page (issue #60): Base, Log
 * and Contributions as collapsible `.lay` blocks, so the tab shows the
 * list of blocks instead of a wall of text. Base starts open (it holds
 * the base key and stats the page is usually opened for); Log and
 * Contributions start closed. Open state lives here, outside the fetched
 * document, so deleting a contribution (which refetches the document)
 * never collapses anything.
 */
import { useState } from "react";
import type { Contribution, SharedContextResponse } from "@unvibe/shared";
import { MarkdownView } from "./MarkdownView.js";

type BlockKey = "base" | "log" | "contributions";

const BLOCKS: { key: BlockKey; heading: string; blurb: string }[] = [
  { key: "base", heading: "Base", blurb: "the base session every conversation starts from" },
  { key: "log", heading: "Log", blurb: "the append-only log" },
  { key: "contributions", heading: "Contributions", blurb: "facts, corrections and questions" },
];

export function SharedContext({
  doc,
  items,
  onDelete,
}: {
  doc: SharedContextResponse;
  items: Contribution[] | null;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<Record<BlockKey, boolean>>({
    base: true,
    log: false,
    contributions: false,
  });

  const setAll = (value: boolean): void =>
    setOpen({ base: value, log: value, contributions: value });

  const onToggle =
    (key: BlockKey) =>
    (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
      const willOpen = e.currentTarget.open;
      setOpen((prev) => (prev[key] === willOpen ? prev : { ...prev, [key]: willOpen }));
      if (!willOpen) {
        // Closing a long block can leave the page scrolled past it; keep
        // the block just closed in view instead.
        e.currentTarget.querySelector("summary")?.scrollIntoView({ block: "nearest" });
      }
    };

  return (
    <>
      <div className="frow" style={{ gap: 8, margin: "6px 0" }}>
        <span className="sp" />
        <button className="x" type="button" onClick={() => setAll(true)}>
          Expand all
        </button>
        <button className="x" type="button" onClick={() => setAll(false)}>
          Collapse all
        </button>
      </div>
      {BLOCKS.map((b) => (
        <section aria-label={b.heading} key={b.key}>
          <details className="lay" open={open[b.key]} onToggle={onToggle(b.key)}>
            <summary>
              <b>{b.heading}</b>
              <span className="hint">{b.blurb}</span>
            </summary>
            <div className="laypad">
              {b.key === "base" ? <MarkdownView markdown={doc.base} /> : null}
              {b.key === "log" ? <MarkdownView markdown={doc.log} /> : null}
              {b.key === "contributions" ? (
                <>
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
                            onClick={() => onDelete(c.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </details>
        </section>
      ))}
    </>
  );
}
