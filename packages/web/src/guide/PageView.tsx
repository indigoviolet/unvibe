/**
 * Guide page (M2, web-guide owner; PRD §4.3, §4.9).
 *
 * Header (type label only where it matters, then the title),
 * trail, collapsible Contents box, cards, and the "Go deeper" divider
 * before pending cards. Finding pages get the rust-accent `.finding`
 * class.
 */
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Card, Page, Plotline } from "@unvibe/shared";
import { DEFAULT_GUIDE_TITLE, isDefaultGuideTitle, PLOTLINE_OTHER_ID, sinceBaselineLabel } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useIsReadOnlyVersion } from "../comments/readOnly.js";
import { ErrorBoundary, InlineFallback } from "../components/ErrorBoundary.js";
import { toast } from "../floating/Toast.js";
import { Icon } from "../components/Icon.js";
import { isLiveJobState, useReview } from "../state/store.js";
import { revealSource } from "../source/reveal.js";
import { performFollowUp } from "./actions.js";
import { CardView } from "./CardView.js";
import { contentsModel, plotlineReviewedState } from "./guideUtils.js";
import { SinceSection } from "./SinceSection.js";
import { Badge, Card as UiCard, ListRow } from "../ui/index.js";
import { InlineCode, stripCodeSpans } from "../components/inlineCode.js";
import { inflightLabel } from "./inflight.js";
import { useReviewIdentity } from "../shell/reviewIdentity.js";

interface Props {
  reviewId: string;
  page: Page;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string | null) => void;
  onJumpToCard: (cardId: string) => void;
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
 * Issue #343: one plotline's reviewed checkbox. A real checkbox — only
 * a checkbox has a native partial state — mirroring the diff's per-file
 * mark-reviewed box. It sits inside the filter row, so its own clicks
 * and keys never reach the row's filter action.
 */
function PlotlineReviewedBox({
  checked,
  partial,
  disabled,
  label,
  plotId,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  disabled: boolean;
  label: string;
  plotId: string;
  onChange: () => void;
}): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial && !checked;
  }, [partial, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="revbox"
      checked={checked}
      disabled={disabled}
      data-tip={label}
      aria-label={label}
      data-plotreviewed={plotId}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={onChange}
    />
  );
}

/**
 * Issue #169: the reader's plotlines on the guide root — a small list
 * between Contents and the cards. Each row jumps to its first hunk in
 * the diff; hunks no plotline claimed read as "Other".
 */
function Plotlines({ reviewId }: { reviewId: string }): ReactNode {
  const snapshot = useReview((s) => s.snapshot);
  // Issue #351: the baseline label (`v1` or a short sha) the
  // `+N`/new markers are relative to. Never the letter "B".
  const sinceLabel = snapshot?.sinceBaseline ? sinceBaselineLabel(snapshot.sinceBaseline) : null;
  // Issue #343: older versions are view-only — the checkbox disables
  // with the usual tooltip, like the diff's other read-only controls.
  const readOnly = useIsReadOnlyVersion();
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
  // Issue #343: reviewed hunks in one plotline (hidden included —
  // like countOf, this never filters), driving the checkbox state.
  const reviewedOf = (plotId: string | undefined): number => {
    let n = 0;
    for (const f of files) {
      for (const h of f.hunks) {
        const s = states.get(h.contentHash);
        if ((s?.plotline ?? PLOTLINE_OTHER_ID) === (plotId ?? PLOTLINE_OTHER_ID) && s?.reviewed === true) n += 1;
      }
    }
    return n;
  };
  // Issue #343: mark every hunk in the plotline reviewed (and fold
  // them) or unmark them all — the same per-hunk path as the diff's
  // per-file mark-all, so one request goes out per hunk.
  const markPlotline = (plotId: string, target: boolean): void => {
    if (readOnly) {
      toast("Viewing an older version · read-only");
      return;
    }
    const hashes: string[] = [];
    for (const f of files) {
      for (const h of f.hunks) {
        if ((states.get(h.contentHash)?.plotline ?? PLOTLINE_OTHER_ID) === plotId) hashes.push(h.contentHash);
      }
    }
    void Promise.all(
      hashes.map((hash) => api.updateHunk(reviewId, hash, { reviewed: target, folded: target }).catch(() => {})),
    ).catch(() => toast("Couldn't save that change"));
  };
  // #324: denominator is every hunk in the review (hidden included —
  // countOf never filters them), so shares sum to the total.
  const totalHunks = files.reduce((n, f) => n + f.hunks.length, 0);
  const otherCount = countOf(undefined);
  // Issue #351: new-side `h:` IDs in the delta, for the per-row
  // `+N since B` markers.
  const sinceIds = (() => {
    const since = snapshot?.sinceHunks;
    if (!since) return null;
    return new Set([...since.added, ...since.changed]);
  })();
  const sinceCountOf = (plotId: string | undefined): number => {
    if (!sinceIds) return 0;
    let n = 0;
    for (const f of files) {
      for (const h of f.hunks) {
        if (!sinceIds.has(`h:${f.fileKey}:${h.contentHash}`)) continue;
        if ((states.get(h.contentHash)?.plotline ?? PLOTLINE_OTHER_ID) === (plotId ?? PLOTLINE_OTHER_ID)) n += 1;
      }
    }
    return n;
  };
  const plotlineOf = (id: string | undefined): Plotline | undefined =>
    id === undefined ? undefined : plotlines.find((p) => p.id === id);
  const nameOf = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return plotlineOf(id)?.name ?? id;
  };
  // Picking a plotline is a filter action (#190): filter the diff to
  // it and jump to its first hunk without clearing the file tree's
  // own filters. The builds-on chip (#242) picks the earlier
  // plotline the same way — it goes to that plotline.
  const pick = (plotId: string, ref: string | null): void => {
    const active = snapshot?.diffFilter?.plotline === plotId;
    const body = {
      plotline: active ? null : plotId,
    };
    api
      .updateDiffFilter(reviewId, body)
      .then(() => {
        if (!active && ref) revealSource(ref, { keepFilters: true });
      })
      .catch(() => {
        toast("Couldn't save the filter");
      });
  };
  const rows = [
    ...plotlines.map((p) => {
      const buildsOn = plotlineOf(p.buildsOn);
      return {
        id: p.id,
        name: p.name,
        desc: p.description,
        buildsOnId: buildsOn?.id,
        buildsOnName: nameOf(p.buildsOn),
        buildsOnRef: buildsOn ? firstRefOf(buildsOn.id) : null,
        count: countOf(p.id),
        reviewed: reviewedOf(p.id),
        ref: firstRefOf(p.id),
        sinceN: sinceCountOf(p.id),
        sinceNew: p.newSinceBaseline === true,
      };
    }),
    ...(otherCount > 0
      ? [
          {
            id: PLOTLINE_OTHER_ID,
            name: "Other",
            desc: "Hunks no plotline claimed.",
            buildsOnId: undefined as string | undefined,
            buildsOnName: undefined as string | undefined,
            buildsOnRef: null as string | null,
            count: otherCount,
            reviewed: reviewedOf(undefined),
            ref: firstRefOf(undefined),
            sinceN: sinceCountOf(undefined),
            sinceNew: false,
          },
        ]
      : []),
  ];
  return (
    <UiCard as="section" variant="inset" className="plotlines" aria-label="Plotlines">
      <h2>Plotlines</h2>
      {totalHunks > 0 ? (
        <div
          className="plshare"
          role="img"
          aria-label={`Hunk shares: ${rows.map((r) => `${stripCodeSpans(r.name)} ${r.count} of ${totalHunks}`).join(", ")}`}
        >
          {rows.map((r, i) => (
            <span
              key={r.id}
              className="plshare-seg"
              data-share={r.id}
              title={`${stripCodeSpans(r.name)}: ${r.count}/${totalHunks}`}
              style={{
                width: `${(r.count / totalHunks) * 100}%`,
                background: `var(--plseg-${i % 5})`,
                opacity: r.id === PLOTLINE_OTHER_ID ? 0.45 : 0.75,
              }}
            />
          ))}
        </div>
      ) : null}
      <ul>
        {rows.map((r) => {
          const active = snapshot?.diffFilter?.plotline === r.id;
          const clickable = r.ref !== null;
          // Issue #343: the row-end checkbox marks the whole plotline
          // reviewed (and folds it) or unmarks it all. Checked when
          // every hunk is reviewed, partial when some are; disabled
          // with the usual tooltip when read-only, or when the
          // plotline has no hunks to mark.
          const reviewState = plotlineReviewedState(r.reviewed, r.count);
          const plotChecked = reviewState === "checked";
          const plotPartial = reviewState === "partial";
          const plotDisabled = readOnly || r.count === 0;
          const plotLabel = readOnly
            ? "Viewing an older version · read-only"
            : plotChecked
              ? "Mark plotline unreviewed"
              : "Mark plotline reviewed";
          return (
            <li key={r.id}>
              <ListRow
                className={active ? "ui-row sel" : "ui-row"}
                {...(clickable
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-pressed": active,
                      "data-plotpick": r.id,
                      "data-tip": active ? "Show all hunks" : `Show only ${stripCodeSpans(r.name)}`,
                      onClick: () => pick(r.id, r.ref),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pick(r.id, r.ref);
                        }
                      },
                    }
                  : {})}
                primary={
                  // Issue #353: names are stored whole; the row clamps to
                  // two lines (CSS), code spans render as code, and the
                  // plain full name is in the tooltip.
                  <span className="plname" data-tip={stripCodeSpans(r.name)}><InlineCode text={r.name} /></span>
                }
                meta={
                  <>
                    {r.desc ? (
                      <span className="pldesc" data-tip={stripCodeSpans(r.desc)}>
                        <InlineCode text={r.desc} />
                      </span>
                    ) : null}
                    {r.buildsOnId && r.buildsOnName ? (
                      <span className="plbuilds">
                        Builds on{" "}
                        <button
                          type="button"
                          className="plbuilds-chip"
                          data-buildson={r.buildsOnId}
                          data-tip={`Show only ${stripCodeSpans(r.buildsOnName)}`}
                          aria-label={`Show only ${stripCodeSpans(r.buildsOnName)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            pick(r.buildsOnId as string, r.buildsOnRef);
                          }}
                        >
                          <Badge tone="outline">{stripCodeSpans(r.buildsOnName)}</Badge>
                        </button>
                      </span>
                    ) : null}
                  </>
                }
                trailing={
                  <>
                    <Badge tone="outline">
                      {totalHunks === 0 ? "no hunks" : `${r.count}/${totalHunks}`}
                    </Badge>
                    {sinceLabel !== null && r.sinceN > 0 && !r.sinceNew ? (
                      <Badge tone="outline" data-since-n={r.id}>
                        +{r.sinceN} since {sinceLabel}
                      </Badge>
                    ) : null}
                    {sinceLabel !== null && r.sinceNew ? (
                      <Badge tone="outline" data-since-new={r.id}>
                        new since {sinceLabel}
                      </Badge>
                    ) : null}
                    <PlotlineReviewedBox
                      checked={plotChecked}
                      partial={plotPartial}
                      disabled={plotDisabled}
                      label={plotLabel}
                      plotId={r.id}
                      onChange={() => markPlotline(r.id, !plotChecked)}
                    />
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </UiCard>
  );
}

export function PageView({ reviewId, page, lookupPage, onOpenPage, onJumpToCard }: Props) {
  const [tocOpen, setTocOpen] = useState(true);
  const { title: identityTitle } = useReviewIdentity(reviewId);
  const isFinding = page.kind === "finding";
  // #235: the PR title lives here on the root, using the heading's style.
  // A default-stored root ("Guide") shows the review title (PR title, else
  // branch); non-default roots and other pages keep today's display.
  const rootTitle =
    page.kind === "root" && isDefaultGuideTitle(page.title) ? identityTitle : displayTitle(page.title);
  const allPages = useReview((s) => s.snapshot?.pages);
  const review = useReview((s) => s.snapshot?.review);
  const jobs = useReview((s) => s.snapshot?.jobs ?? []);
  const inflight = useReview((s) => s.inflight);
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

  const renderCard = (card: Card, index: number) => (
    // Fragment (not a div): `.doc.finding > .ui-card` and other child
    // selectors in prototype.css depend on the section being a direct child.
    // The boundary itself renders no element, and its fallback keeps the
    // card shape, so the selectors hold in both states.
    <Fragment key={card.id}>
      {index === goDeeperIndex ? <div className="divider">Go deeper</div> : null}
      <ErrorBoundary
        name="guide-card"
        resetKey={`${reviewId}:${card.id}:${card.revision ?? 0}`}
        fallback={({ reset }) => (
          <UiCard as="section" variant="raised">
            <InlineFallback message="Couldn't show this card: something went wrong" onRetry={reset} />
          </UiCard>
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

  const titleFor = (p: Page): string =>
    p.id === page.id ? rootTitle : p.kind === "root" && isDefaultGuideTitle(p.title) ? rootTitle : displayTitle(p.title);

  return (
    <div className={`doc${isFinding ? " finding" : ""}`}>
      {trail.length > 1 ? (
        <nav className="crumbs" aria-label="Trail">
          {trail.map((p, i) =>
            i === trail.length - 1 ? (
              <span key={p.id}>{titleFor(p)}</span>
            ) : (
              <span key={p.id}>
                <button type="button" onClick={() => onOpenPage(p.id === "root" ? null : p.id)}>
                  {titleFor(p)}
                </button>
                <span> › </span>
              </span>
            ),
          )}
        </nav>
      ) : null}
      {eyebrow ? <div className={`eyebrow${isFinding ? " find" : ""}`}>{eyebrow}</div> : null}
      <div className="title-row">
        <h1 className="title">{rootTitle}</h1>
      </div>
      {isFinding && page.summary ? <div className="meta">{page.summary}</div> : null}
      <RecheckStatus page={page} />
      {page.kind === "root" && review ? (
        <SinceSection reviewId={reviewId} review={review} renderCard={(card) => renderCard(card, 0)} />
      ) : null}
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
      <UiCard as="nav" variant="inset" className="toc" aria-label="Contents">
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
      </UiCard>
      {page.kind === "root" ? <Plotlines reviewId={reviewId} /> : null}
      {page.cards.map(renderCard)}
    </div>
  );
}
