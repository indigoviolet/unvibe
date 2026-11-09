/**
 * End-of-block markers (M2, web-guide owner; PRD §4.5) + anchor footnotes
 * (issue #72, PRD §4.7).
 *
 * - `<>` citation marker per verified group (count when >1); hover previews
 *   the cited lines, click reveals the source. Unverified citations get
 *   no marker at all (issue #264): the surrounding text stays plain text
 *   and the failure stays on the job for the Debug page.
 * - No end-of-block comment bubble (issue #374): every thread on the card
 *   already has a margin pill (`ThreadMarginOverlay`), which is the single
 *   entry point — the bubble showed the same threads twice. Threads whose
 *   quote is lost get a footnote chip instead (same row, with their quote).
 * - Footnote chips (`footnotes` + quoted threads): one quiet row shared with
 *   the citations chip. Closed expansions become thread-link marks
 *   (`mark.anc.exl[data-jump]`, soft highlight + thread glyph in the guide
 *   per issue #302, hover previews + click expands via the
 *   existing `ExpansionHighlights` handlers); promoted links become page
 *   links (`a.cx.pg[data-node]`, hover previews via `HoverPopover`, click
 *   opens via `onOpenPage`); comment threads become marks (`mark.anc[data-thr]`,
 *   click toggles via `GuideThreads`, which also owns their `.th` chips).
 *   Agent (explain/ask) threads never grow `.th` chips (issue #303): their
 *   marks and fallback chips come from `ExpansionHighlights` + `footnotes`. All start `hidden` and are revealed
 *   by the highlight passes when their quote is not found in the host text,
 *   so switching back to a level that contains the phrase hides them again.
 */
import { type Thread } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { revealSource } from "../source/reveal.js";
import { isPromotedLink } from "./expansions/expansionUtils.js";
import type { ResolvedCitation } from "./citations.js";
import { citationChip } from "./citations.js";

interface Props {
  citations: ResolvedCitation[];
  threads: Thread[];
  /** Closed expansions + promoted links anchored on this block. */
  footnotes?: Thread[];
  blockId: string;
  onOpenPage?: (pageId: string) => void;
}

export function BlockMarkers({ citations, threads, footnotes, onOpenPage }: Props) {
  // Issue #336: the prose chip never renders empty — `citationChip` is
  // null unless at least one verified, non-blank target exists.
  const chip = citationChip(citations);
  // Issue #374: no end-of-block bubble — the margin pill already covers
  // every thread on the card (quoted or not). Quoted threads whose
  // highlight is lost keep their footnote chip below instead.
  // Issue #303: `.th` chips belong to GuideThreads, which only tracks
  // threads with a reviewer comment (its marks and chip toggle cover
  // those alone). Agent (explain/ask) threads render their marks and
  // fallback chips through ExpansionHighlights + `footnotes` instead —
  // giving them a `.th` chip too shows the thread twice, because
  // GuideThreads never hides a chip it doesn't track.
  const quotedThreads = threads.filter(
    (t) => !!t.anchor.quotedText && (t.replies ?? []).some((r) => r.kind === "comment"),
  );
  const notes = footnotes ?? [];
  if (!chip && !notes.length && !quotedThreads.length) return null;
  return (
    <span className="lo">
      {chip && (
        <button
          className="lk"
          type="button"
          data-refs={chip.targets.join("|")}
          data-src={chip.targets[0]}
          aria-label={chip.targets.length > 1 ? `${chip.targets.length} sources` : "Source"}
          data-tip="Show in source"
          onClick={() => revealSource(chip.targets[0])}
        >
          {chip.text}
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
