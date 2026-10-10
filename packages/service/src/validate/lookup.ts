/**
 * Citation lookup interface (PRD §10): what the validator needs from a
 * review version. The lookup answers existence, ranges and host text;
 * the validator decides valid / repaired / unverified.
 *
 * `createSnapshotLookup` (in `snapshot.ts`) implements this over the shared
 * `ReviewSnapshot` type.
 */
export interface HunkLocation {
  hash: string;
  start: number;
  end: number;
}

export interface ReviewLookup {
  /** Resolve a file key or alias (e.g. prototype `conn`) to a real fileKey. */
  resolveFileKey(key: string): string | null;
  /** The hunk covering a new-side line, if any. */
  hunkAtLine(fileKey: string, line: number): HunkLocation | null;
  /** New-side range of a hunk by content hash, if it exists. */
  hunkRange(fileKey: string, hash: string): { start: number; end: number } | null;
  /** File length at a commit for `code:` ranges; null when unknown. */
  fileLineCount(keyOrPath: string): number | null;
  /** Description paragraph text by id; null when unknown. */
  descParagraph(id: string): string | null;
  pageExists(id: string): boolean;
  cardExists(id: string): boolean;
  blockExists(cardId: string, blockId: string): boolean;
  /** Unknown `concept:` slugs become hidden candidates (still valid). */
  conceptKnown(slug: string): boolean;
  annotationExists(id: string): boolean;
  /** Plain text of an anchor host (`card:…#…`, `desc:…`, `diff:…`). */
  hostText(host: string): string | null;
  /** Old-version ID → current-version ID (PRD §8 mapping); null if none. */
  mapId(id: string): string | null;
}
