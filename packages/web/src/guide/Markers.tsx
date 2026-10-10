/**
 * End-of-block markers (M2, web-guide owner; PRD §4.5).
 *
 * - `<>` citation marker per verified group (count when >1); hover previews
 *   the cited lines, click reveals the source. Each *unverified* citation
 *   gets its own dimmed marker with an explanatory tooltip.
 * - Speech-bubble comment marker with a count for threads anchored on the
 *   block (threads UI itself is a later milestone; see `annotations.ts`).
 */
import type { Annotation } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { revealSource } from "../source/reveal.js";
import { openBlockThread } from "./annotations.js";
import type { ResolvedCitation } from "./citations.js";

interface Props {
  citations: ResolvedCitation[];
  threads: Annotation[];
  blockId: string;
}

export function BlockMarkers({ citations, threads, blockId }: Props) {
  const verified = citations.filter((c) => !c.unverified);
  const unverified = citations.filter((c) => c.unverified);
  if (!citations.length && !threads.length) return null;
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
          data-tip="This citation could not be checked, so it is shown as unverified."
          onClick={() => revealSource(c.target)}
        >
          <Icon name="code" />
        </button>
      ))}
      {threads.length > 0 && (
        <button
          className="lk cm"
          type="button"
          data-threads={threads.map((t) => t.id).join("|")}
          aria-label={`${threads.length} comments`}
          data-tip="Preview the comment thread"
          onClick={() => openBlockThread(threads[0].id, blockId)}
        >
          <Icon name="comment" />
          {threads.length}
        </button>
      )}
    </span>
  );
}
