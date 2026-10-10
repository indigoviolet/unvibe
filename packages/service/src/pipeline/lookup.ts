/**
 * Build a `ReviewLookup` over the live snapshot for citation validation.
 *
 * Description paragraphs come from the stored description HTML (ids `d-pN`
 * in demo fixtures, or `id="..."` attributes when present). File lengths
 * for `code:` ranges are derived from hunk coverage (unknown files return
 * null, so `code:` tokens to outside files validate as unverified rather
 * than crashing). Concepts are the union of reader-declared slugs and
 * existing concept pages. Host texts for anchor checks come from the
 * snapshot (card blocks, description, diff lines).
 */
import type { ReviewSnapshot } from "@unvibe/shared";
import { createSnapshotLookup } from "../validate/index.js";

function descTextsOf(html: string): Record<string, string> {
  if (!html) return {};
  const out: Record<string, string> = {};
  // Prefer explicit id="..." attributes.
  for (const m of html.matchAll(/id="([^"]+)"[^>]*>([\s\S]*?)<\//g)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out[m[1]] = text;
  }
  // Fallback: d-pN in order (demo fixtures).
  const paras = html
    .split(/<\/(?:p|li|h\d)>/i)
    .map((s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  paras.forEach((text, i) => {
    const id = `d-p${i + 1}`;
    if (!out[id]) out[id] = text;
  });
  return out;
}

export function lookupForSnapshot(snapshot: ReviewSnapshot): ReturnType<typeof createSnapshotLookup> {
  const descTexts = descTextsOf(snapshot.description?.html ?? "");
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
