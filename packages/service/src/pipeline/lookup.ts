/**
 * Build a `ReviewLookup` over the live snapshot for citation validation.
 *
 * Description paragraphs come from the stored description HTML through the
 * single source (`parseDescriptionParagraphs`, issue #96): the `id="..."`
 * attributes ingest wrote. File lengths for `code:` ranges are
 * derived from hunk coverage (unknown files return null, so `code:` tokens
 * to outside files validate as unverified rather than crashing). Concepts
 * are the union of reader-declared slugs and existing concept pages. Host
 * texts for anchor checks come from the snapshot (card blocks,
 * description, diff lines).
 */
import type { ReviewSnapshot } from "@unvibe/shared";
import { currentDescriptionHtml, parseDescriptionParagraphs } from "../ingest/description.js";
import { createSnapshotLookup } from "../validate/index.js";

function descTextsOf(html: string): Record<string, string> {
  return Object.fromEntries(parseDescriptionParagraphs(html).map((p) => [p.id, p.text]));
}

export function lookupForSnapshot(snapshot: ReviewSnapshot): ReturnType<typeof createSnapshotLookup> {
  const descTexts = descTextsOf(currentDescriptionHtml(snapshot.description));
  const concepts = new Set<string>();
  for (const page of snapshot.pages) {
    if (page.kind === "concept") {
      const slug = page.id.startsWith("c-") ? page.id.slice(2) : page.id;
      concepts.add(slug);
    }
  }
  // Reader-declared concepts may not have pages yet; they are still known
  // so their tokens validate (they become hidden candidates only when
  // truly unknown). We collect them from the snapshot's concept index via
  // page titles? For validation, unknown slugs are valid candidates, so
  // we do NOT need to pre-register them: `conceptKnown` false → candidate.
  // Keep the set as existing pages only.
  return createSnapshotLookup(snapshot, {
    descTexts,
    concepts: [...concepts],
  });
}
