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
import { parseId } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { currentDescriptionHtml, parseDescriptionParagraphs } from "../ingest/description.js";
import { readCodeSlice } from "../mcp/read.js";
import { createSnapshotLookup } from "../validate/index.js";

function descTextsOf(html: string): Record<string, string> {
  return Object.fromEntries(parseDescriptionParagraphs(html).map((p) => [p.id, p.text]));
}

export function lookupForSnapshot(
  snapshot: ReviewSnapshot,
  extra: { fileLengths?: Record<string, number> } = {},
): ReturnType<typeof createSnapshotLookup> {
  const descTexts = descTextsOf(currentDescriptionHtml(snapshot.description));
  const concepts = new Set<string>();
  for (const page of snapshot.pages) {
    if (page.kind === "concept" && page.id.startsWith("c-")) {
      concepts.add(page.id.slice(2));
    }
  }
  // Concepts with no page yet are still valid links: their page is
  // written when the reader opens the link (#216), so we do NOT need to
  // pre-register them: `conceptKnown` false → candidate.
  // Keep the set as existing (opened) pages only.
  return createSnapshotLookup(snapshot, {
    descTexts,
    concepts: [...concepts],
    ...(extra.fileLengths ? { fileLengths: extra.fileLengths } : {}),
  });
}

/**
 * Resolve file lengths for every distinct `code:` target in `targets`
 * against the file at its cited commit (PRD §10: a `code:` range must lie
 * inside the file at that commit, not inside a hunk). Reads go through
 * `readCodeSlice` (`git show <rev>:<path>`), the same source `get_code`
 * serves, so a citation the tool issued — or any citation to a real file
 * at the review's commit — validates. Unreadable, binary or missing files
 * get no entry, so their citations stay unverified. Never throws.
 */
export async function resolveCodeFileLengths(
  commands: CommandRunner,
  cwd: string,
  headSha: string,
  targets: Iterable<string>,
): Promise<Record<string, number>> {
  const seen = new Map<string, string>();
  for (const target of targets) {
    const parsed = parseId(target);
    if (parsed?.kind !== "code") continue;
    if (!seen.has(parsed.path)) seen.set(parsed.path, parsed.sha ?? headSha);
  }
  const out: Record<string, number> = {};
  for (const [filePath, rev] of seen) {
    if (!filePath || filePath.includes("\0") || filePath.startsWith("/") || filePath.split(/[\\/]/).includes("..")) continue;
    const slice = await readCodeSlice(commands, cwd, rev, filePath, 1, 1);
    if ("totalLines" in slice && slice.totalLines !== undefined) out[filePath] = slice.totalLines;
  }
  return out;
}
