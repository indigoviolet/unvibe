/**
 * Guide page (M2, web-guide owner; PRD §4.3, §4.9).
 *
 * Header (type label only where it matters, then the title with the
 * bookmark right-aligned on its line — #118, deliberately off-prototype),
 * trail, collapsible Contents box, cards, and the "Go deeper" divider
 * before pending cards. Finding pages get the rust-accent `.finding`
 * class.
 */
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Card, Page, Plotline } from "@unvibe/shared";
import { DEFAULT_GUIDE_TITLE, isDefaultGuideTitle, PLOTLINE_OTHER_ID } from "@unvibe/shared";
import { api } from "../api/client.js";
import { ErrorBoundary, InlineFallback } from "../components/ErrorBoundary.js";
import { toast } from "../floating/Toast.js";
import { Icon } from "../components/Icon.js";
import { isLiveJobState, useReview } from "../state/store.js";
import { revealSource } from "../source/reveal.js";
import { performAction, performFollowUp } from "./actions.js";
import { CardView } from "./CardView.js";
import { contentsModel } from "./guideUtils.js";
import { inflightLabel } from "./inflight.js";

interface Props {
  reviewId: string;
  page: Page;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string | null) => void;
  onJumpToCard: (cardId: string) => void;
}

/** Bookmark state: explicit flag wins, concept pages default to saved. */
export function isSaved(page: Page): boolean {
  return page.saved || page.kind === "concept";
}

/** Finding recheck status line (PRD §8): set by refresh / the update pass. */
function RecheckStatus({ page }: { page: Page }) {
  if (page.kind !== "finding") return null;
  const { needsRecheck, recheckStatus, recheckNote } = page;
  if (!needsRecheck && !recheckStatus) return null;
  const text =
    recheckStatus === "still-applies"
      ? "Rechecked · still applies"
      : recheckStatus === "resolved"
        ? "Rechecked · resolved"
        : recheckStatus === "changed"
          ? "Rechecked · changed"
          : "Cited code changed · not rechecked yet";
  return (
    <div className="meta" data-recheck={recheckStatus ?? "pending"}>
      <span>{text}</span>
      {recheckNote ? <span>{recheckNote}</span> : null}
    </div>
  );
}

/** Display form of a page title: the default shows as "Guide". */
function displayTitle(title: string): string {
  return isDefaultGuideTitle(title) ? DEFAULT_GUIDE_TITLE : title;
}

/**
 * Issue #169: the reader's plotlines on the guide root — a small list
 * between Contents and the cards. Each row jumps to its first hunk in
 * the diff; hunks no plotline claimed read as "Other".
 */
function Plotlines({ reviewId }: { reviewId: string }): ReactNode {
  const snapshot = useReview((s) => s.snapshot);
  const plotlines: Plotline[] = snapshot?.plotlines ?? [];
  if (plotlines.length === 0) return null;
  const files = snapshot?.files ?? [];
  const states = new Map((snapshot?.hunkStates ?? []).map((s) => [s.contentHash, s]));
  const firstRefOf = (plotId: string | undefined): string | null => {
    for (const f of files) {
      for (const h of f.hunks) {
        if ((states.get(h.contentHash)?.plotline ?? PLOTLINE_OTHER_ID) === (plotId ?? PLOTLINE_OTHER_ID)) {
          return `diff:${f.fileKey}:${h.newStart}`;
        }
      }
    }
    return null;
  };
  const countOf = (plotId: string | undefined): number => {
    let n = 0;
    for (const f of files) {
      for (const h of f.hunks) {
        if ((states.get(h.contentHash)?.plotline ?? PLOTLINE_OTHER_ID) === (plotId ?? PLOTLINE_OTHER_ID)) n += 1;
      }
    }
    return n;
  };
  const otherCount = countOf(undefined);
  const rows = [
    ...plotlines.map((p) => ({ id: p.id, name: p.name, desc: p.description, count: countOf(p.id), ref: firstRefOf(p.id) })),
    ...(otherCount > 0 ? [{ id: PLOTLINE_OTHER_ID, name: "Other", desc: "Hunks no plotline claimed.", count: otherCount, ref: firstRefOf(undefined) }] : []),
  ];
  return (
    <section className="plotlines" aria-label="Plotlines">
      <h2>Plotlines</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            {r.ref ? (
              <button
                type="button"
                className={snapshot?.diffFilter?.plotline === r.id ? "sel" : undefined}
                aria-pressed={snapshot?.diffFilter?.plotline === r.id}
                data-plotpick={r.id}
                data-tip={snapshot?.diffFilter?.plotline === r.id ? "Show all hunks" : `Show only ${r.name}`}
                onClick={() => {
                  const active = snapshot?.diffFilter?.plotline === r.id;
                  const body = {
                    plotline: active ? null : r.id,
                    score: snapshot?.diffFilter?.score ?? null,
                  };
                  api
                    .updateDiffFilter(reviewId, body)
                    .then(() => {
                      if (!active) revealSource(r.ref as string);
                    })
                    .catch(() => {
                      toast("Couldn't save the filter");
                    });
                }}
              >
                <span className="plname">{r.name}</span>
                {r.desc ? <span className="pldesc"> — {r.desc}</span> : null}
                <span className="plcount">
                  {r.count} {r.count === 1 ? "hunk" : "hunks"}
                </span>
              </button>
            ) : (
              <span>
                <span className="plname">{r.name}</span>
                {r.desc ? <span className="pldesc"> — {r.desc}</span> : null}
                <span className="plcount">no hunks</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PageView({ reviewId, page, lookupPage, onOpenPage, onJumpToCard }: Props) {
  const [tocOpen, setTocOpen] = useState(true);
  const isFinding = page.kind === "finding";
  const saved = isSaved(page);
  const allPages = useReview((s) => s.snapshot?.pages);
  const jobs = useReview((s) => s.snapshot?.jobs ?? []);
  const inflight = useReview((s) => s.inflight);
  const contributions = useReview((s) => s.snapshot?.contributions ?? []);
  const { cards, links } = contentsModel(page, lookupPage, allPages);

  // Breadcrumb back to the root (PRD §4.3 trail), following parent links.
  const trail: Page[] = [];
  {
    const seen = new Set<string>();
    let cur: Page | undefined = page;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      trail.unshift(cur);
      cur = cur.parent ? lookupPage(cur.parent) : undefined;
    }
  }

  const eyebrow = isFinding ? `Agent finding · ${page.confidence ?? ""} confidence` : "";

  const goDeeperIndex = page.cards.findIndex((c) => c.pending);

  // Concept pages are written on first open: while the `concept` action is
  // in flight (or its job runs) for an empty stub card, show a plain
  // working state with a fixed label — never streamed or progress text.
  const conceptWorking = (() => {
    if (page.kind !== "concept" && page.kind !== "opened-expansion") return null;
    const stub = page.cards[0];
    if (!stub || stub.blocks.length > 0) return null;
    const entry = inflight[page.id] ?? inflight[stub.id];
    if (entry) return inflightLabel(entry.kind);
    const job = jobs.find(
      (j) =>
        (j.cardId === stub.id || j.dedupeKey?.includes(`concept:${page.id.slice(2)}`)) &&
        isLiveJobState(j.state),
    );
    if (!job) return null;
    return inflightLabel("concept");
  })();

  // Small unobtrusive indicator when a conversation contributed facts/open
  // questions to shared context (PRD §9.5), linking to the debug page.
  const sharedCount = contributions.filter((c) =>
    c.items.some((i) => i.kind === "fact" || i.kind === "open_question"),
  ).length;

  const renderCard = (card: Card, index: number) => (
    // Fragment (not a div): `.doc.finding > .card` and other child
    // selectors in prototype.css depend on the section being a direct child.
    // The boundary itself renders no element, and its fallback keeps the
    // card shape, so the selectors hold in both states.
    <Fragment key={card.id}>
      {index === goDeeperIndex ? <div className="divider">Go deeper</div> : null}
      <ErrorBoundary
        name="guide-card"
        resetKey={`${reviewId}:${card.id}:${card.revision ?? 0}`}
        fallback={({ reset }) => (
          <section className="card">
            <InlineFallback message="Couldn't show this card: something went wrong" onRetry={reset} />
          </section>
        )}
      >
        <CardView
          reviewId={reviewId}
          card={card}
          lookupPage={lookupPage}
          onOpenPage={(id) => onOpenPage(id)}
          onFollowUp={(cardId, blockId, i) => performFollowUp(reviewId, cardId, blockId, i)}
        />
      </ErrorBoundary>
    </Fragment>
  );

  return (
    <div className={`doc${isFinding ? " finding" : ""}`}>
      {trail.length > 1 ? (
        <nav className="crumbs" aria-label="Trail">
          {trail.map((p, i) =>
            i === trail.length - 1 ? (
              <span key={p.id}>{displayTitle(p.title)}</span>
            ) : (
              <span key={p.id}>
                <button type="button" onClick={() => onOpenPage(p.id === "root" ? null : p.id)}>
                  {displayTitle(p.title)}
                </button>
                <span> › </span>
              </span>
            ),
          )}
        </nav>
      ) : null}
      {eyebrow ? <div className={`eyebrow${isFinding ? " find" : ""}`}>{eyebrow}</div> : null}
      <div className="title-row">
        <h1 className="title">{displayTitle(page.title)}</h1>
        <button
          className="ib save"
          type="button"
          data-tip={saved ? "Saved to this repo · click to unsave" : "Save to this repo"}
          aria-label={saved ? "Saved to this repo · click to unsave" : "Save to this repo"}
          aria-pressed={saved}
          data-save={page.id}
          onClick={() =>
            void performAction(reviewId, { kind: "bookmark", pageId: page.id, saved: !saved })
          }
        >
          <Icon name="bookmark" />
        </button>
      </div>
      {isFinding && page.summary ? <div className="meta">{page.summary}</div> : null}
      <RecheckStatus page={page} />
      {conceptWorking ? (
        <div className="working" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{conceptWorking}</span>
        </div>
      ) : null}
      {sharedCount > 0 ? (
        <p className="hint" data-shared-indicator>
          The agent kept {sharedCount} {sharedCount === 1 ? "note" : "notes"} from your conversations in this review ·{" "}
          <Link to={`/review/${encodeURIComponent(reviewId)}/debug?tab=context`}>Debug → Shared context</Link>
        </p>
      ) : null}
      <nav className="toc" aria-label="Contents">
        <div className="toc-h">
          <button
            className="ib"
            type="button"
            data-tip={tocOpen ? "Hide contents" : "Show contents"}
            aria-label={tocOpen ? "Hide contents" : "Show contents"}
            data-toc=""
            onClick={() => setTocOpen((v) => !v)}
          >
            <Icon name={tocOpen ? "down" : "right"} />
          </button>
          <span>Contents</span>
        </div>
        {tocOpen ? (
          <div className="toc-g">
            <div>
              <h3>On this page</h3>
              <ul>
                {cards.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      data-tocard={entry.id}
                      onClick={() => onJumpToCard(entry.id)}
                    >
                      <span className="tt">{entry.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {links.length ? (
              <div>
                <h3>Linked pages</h3>
                <ul>
                  {links.map((entry) => (
                    <li key={entry.id}>
                      <button type="button" data-node={entry.id} onClick={() => onOpenPage(entry.id)}>
                        <span className="tt">{entry.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
      {page.kind === "root" ? <Plotlines reviewId={reviewId} /> : null}
      {page.cards.map(renderCard)}
    </div>
  );
}
