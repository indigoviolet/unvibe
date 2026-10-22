/**
 * Build a `ReviewLookup` over the live snapshot for citation validation.
 *
 * Description paragraphs come from the stored description HTML through the
 * single source (`parseDescriptionParagraphs`, issue #96): the `id="..."`
 * attributes ingest wrote. Whether a `code:` file exists at its cited
 * commit comes from `resolveCodeFileExistence` (unknown files validate as
 * unverified rather than crashing). Concepts are the union of
 * reader-declared slugs and existing concept pages. Host texts for anchor
 * checks come from the snapshot (card blocks, description, diff lines).
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
  extra: { existingFiles?: ReadonlySet<string>; existingCodeTargets?: ReadonlySet<string> } = {},
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
    ...(extra.existingFiles ? { existingFiles: extra.existingFiles } : {}),
    ...(extra.existingCodeTargets ? { existingCodeTargets: extra.existingCodeTargets } : {}),
  });
}

/**
 * Resolve which distinct `code:` targets in `targets` name a file that
 * exists at its cited commit (#81: existence only, no length check).
 * Reads go through `readCodeSlice` (`git show <rev>:<path>`), the same
 * source `get_code` serves, so a citation the tool issued — or any
 * citation to a real file at the review's commit — validates. A slice
 * that comes back with a line count (a hit, or past-the-end on a real
 * file) proves existence; missing and binary files get no entry, so
 * their citations stay unverified. Never throws.
 */
export async function resolveCodeFileExistence(
  commands: CommandRunner,
  cwd: string,
  headSha: string,
  targets: Iterable<string>,
): Promise<Set<string>> {
  const seen = new Map<string, string>();
  for (const target of targets) {
    const parsed = parseId(target);
    if (parsed?.kind !== "code") continue;
    if (!seen.has(parsed.path)) seen.set(parsed.path, parsed.sha ?? headSha);
  }
  const out = new Set<string>();
  for (const [filePath, rev] of seen) {
    if (!filePath || filePath.includes("\0") || filePath.startsWith("/") || filePath.split(/[\\/]/).includes("..")) continue;
    const slice = await readCodeSlice(commands, cwd, rev, filePath, 1, 1);
    if ("totalLines" in slice && slice.totalLines !== undefined) out.add(filePath);
  }
  return out;
}
