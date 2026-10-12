/**
 * Guide page (M2, web-guide owner; PRD §4.3, §4.9).
 *
 * Header (type label only where it matters + bookmark + title), trail,
 * collapsible Contents box, cards, and the "Go deeper" divider before
 * pending cards. Finding pages get the rust-accent `.finding` class.
 */
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import type { Card, Page } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { isLiveJobState, useReview } from "../state/store.js";
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
          : "Cited code changed · awaiting recheck";
  return (
    <div className="meta" data-recheck={recheckStatus ?? "pending"}>
      <span>{text}</span>
      {recheckNote ? <span>{recheckNote}</span> : null}
    </div>
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

  const eyebrow =
    page.kind === "root"
      ? "Guided review"
      : isFinding
        ? `Agent finding · ${page.confidence ?? ""} confidence`
        : "";

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
    <Fragment key={card.id}>
      {index === goDeeperIndex ? <div className="divider">Go deeper</div> : null}
      <CardView
        reviewId={reviewId}
        card={card}
        lookupPage={lookupPage}
        onOpenPage={(id) => onOpenPage(id)}
        onFollowUp={(cardId, blockId, i) => performFollowUp(reviewId, cardId, blockId, i)}
      />
    </Fragment>
  );

  return (
    <div className={`doc${isFinding ? " finding" : ""}`}>
      {trail.length > 1 ? (
        <nav className="crumbs" aria-label="Trail">
          {trail.map((p, i) =>
            i === trail.length - 1 ? (
              <span key={p.id}>{p.title}</span>
            ) : (
              <span key={p.id}>
                <button type="button" onClick={() => onOpenPage(p.id === "root" ? null : p.id)}>
                  {p.title}
                </button>
                <span> › </span>
              </span>
            ),
          )}
        </nav>
      ) : null}
      <div className={`eyebrow${isFinding ? " find" : ""}`}>
        {eyebrow}
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
      <h1 className="title">{page.title}</h1>
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
          {sharedCount} shared context {sharedCount === 1 ? "item" : "items"} from this review ·{" "}
          <Link to={`/review/${encodeURIComponent(reviewId)}/debug`}>Debug → Shared context</Link>
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
                  <li key={entry.id} className={entry.read ? "done" : ""}>
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
                    <li key={entry.id} className={entry.read ? "done" : ""}>
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
      {page.cards.map(renderCard)}
    </div>
  );
}
