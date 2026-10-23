/**
 * End-of-block markers (M2, web-guide owner; PRD §4.5) + anchor footnotes
 * (issue #72, PRD §4.7).
 *
 * - `<>` citation marker per verified group (count when >1); hover previews
 *   the cited lines, click reveals the source. Each *unverified* citation
 *   gets its own dimmed marker with an explanatory tooltip.
 * - Speech-bubble comment marker with a count, only for threads that never
 *   had a quote (PRD §4.6). Threads whose quote is lost get a footnote chip
 *   instead (same row, with their quote).
 * - Footnote chips (`footnotes` + quoted threads): one quiet row shared with
 *   the citations chip. Closed expansions become dotted-link marks
 *   (`mark.anc.exl[data-jump]`, hover previews + click expands via the
 *   existing `ExpansionHighlights` handlers); promoted links become page
 *   links (`a.cx.pg[data-node]`, hover previews via `HoverPopover`, click
 *   opens via `onOpenPage`); threads become marks (`mark.anc[data-thr]`,
 *   click toggles via `GuideThreads`). All start `hidden` and are revealed
 *   by the highlight passes when their quote is not found in the host text,
 *   so switching back to a level that contains the phrase hides them again.
 */
import type { Annotation } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { revealSource } from "../source/reveal.js";
import { closeBlockThreads, openBlockThreads } from "./annotations.js";
import { isPromotedLink } from "./expansions/expansionUtils.js";
import type { ResolvedCitation } from "./citations.js";

interface Props {
  citations: ResolvedCitation[];
  threads: Annotation[];
  /** Closed expansions + promoted links anchored on this block. */
  footnotes?: Annotation[];
  blockId: string;
  onOpenPage?: (pageId: string) => void;
}

export function BlockMarkers({ citations, threads, footnotes, blockId, onOpenPage }: Props) {
  const verified = citations.filter((c) => !c.unverified);
  const unverified = citations.filter((c) => c.unverified);
  // Threads that never had a quote keep the bare bubble marker (PRD §4.6);
  // quoted threads get footnote chips when their highlight is lost.
  const unquoted = threads.filter((t) => !t.anchor.quotedText);
  // Issue #262: the marker is a toggle. When every one of its threads
  // is already open a click collapses all of them; otherwise (none open,
  // or a mix) a click opens all of them. The tooltip states the action.
  const unquotedIds = unquoted.map((t) => t.id);
  const allOpen = unquoted.length > 0 && unquoted.every((t) => t.open);
  const markerTip = allOpen ? "Hide comments" : "Show comments";
  const toggleThreads = (): void => {
    if (allOpen) closeBlockThreads(unquotedIds, blockId);
    else openBlockThreads(unquotedIds, blockId);
  };
  const quotedThreads = threads.filter((t) => !!t.anchor.quotedText);
  const notes = footnotes ?? [];
  if (!citations.length && !unquoted.length && !notes.length && !quotedThreads.length) return null;
  return (
    <span className="lo">
      {verified.length > 0 && (
        <button
          className="lk"
          type="button"
          data-refs={verified.map((c) => c.target).join("|")}
          data-src={verified[0].target}
          aria-label={verified.length > 1 ? `${verified.length} sources` : "Source"}
          data-tip="Show in source"
          onClick={() => revealSource(verified[0].target)}
        >
          <Icon name="code" />
          {verified.length > 1 ? verified.length : ""}
        </button>
      )}
      {unverified.map((c) => (
        <button
          key={c.target}
          className="lk unverified"
          type="button"
          data-refs={c.target}
          data-src={c.target}
          aria-label="Unverified source"
          data-tip="Unvibe couldn't confirm this points at the right code."
          onClick={() => revealSource(c.target)}
        >
          <Icon name="code" />
        </button>
      ))}
      {unquoted.length > 0 && (
        <button
          className="lk cm"
          type="button"
          data-threads={unquoted.map((t) => t.id).join("|")}
          aria-label={`${unquoted.length} comments`}
          data-tip={markerTip}
          onClick={toggleThreads}
        >
          <Icon name="comment" />
          {unquoted.length}
        </button>
      )}
      {notes.map((a) => {
        const quote = a.anchor.quotedText ?? "";
        if (!quote) return null;
        if (isPromotedLink(a)) {
          const pageId = a.promotedToPage ?? "";
          if (!pageId) return null;
          return (
            <a
              key={a.id}
              className="cx pg fnote"
              data-node={pageId}
              data-fallback={a.id}
              hidden
              title={quote}
              aria-label={`Open page: ${quote}`}
              onClick={(e) => {
                e.preventDefault();
                onOpenPage?.(pageId);
              }}
            >
              <Icon name="open" />
              <span className="q">{quote}</span>
            </a>
          );
        }
        // Closed expansion: dotted-link mark so the existing
        // `mark.anc[data-jump]` hover preview + click-to-expand handlers
        // apply unchanged.
        return (
          <mark
            key={a.id}
            className="anc exl fnote"
            data-jump={a.id}
            data-fallback={a.id}
            hidden
            title={quote}
          >
            <span className="q">{quote}</span>
          </mark>
        );
      })}
      {quotedThreads.map((t) => {
        const quote = t.anchor.quotedText ?? "";
        return (
          <mark
            key={t.id}
            className="anc fnote th"
            data-thr={t.id}
            data-tfallback={t.id}
            hidden
            title={quote}
          >
            <Icon name="comment" />
            <span className="q">{quote}</span>
          </mark>
        );
      })}
    </span>
  );
}
