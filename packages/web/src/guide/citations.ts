/**
 * Citation preview resolution (web-guide owner).
 *
 * Order: live snapshot rows first (real `HunkLine` rows), then the
 * description paragraphs, then nothing (unknown targets resolve to a bare
 * label, never a crash). Snapshots store canonical file keys, so no alias
 * map is needed.
 */
import type { Citation, HunkLine, ReviewSnapshot } from "@unvibe/shared";
import { documentBlockText, parseId } from "@unvibe/shared";
import { descriptionPaneName } from "../source/description/paneName.js";

export interface ResolvedCitation {
  target: string;
  label: string;
  snippet: string;
  unverified?: boolean;
}

export type FileKeyAliases = Record<string, string>;

function resolveFile(
  snapshot: ReviewSnapshot,
  key: string,
  aliases: FileKeyAliases = {},
): { fileKey: string; path: string } | null {
  const exact = snapshot.files.find((f) => f.fileKey === key);
  if (exact) return { fileKey: exact.fileKey, path: exact.path };
  const aliased = aliases[key];
  if (aliased) {
    const file = snapshot.files.find((f) => f.fileKey === aliased);
    if (file) return { fileKey: file.fileKey, path: file.path };
  }
  const byPath = snapshot.files.find((f) => f.path === key);
  if (byPath) return { fileKey: byPath.fileKey, path: byPath.path };
  return null;
}

function descText(snapshot: ReviewSnapshot, paragraph: string): string | null {
  const html = snapshot.description?.html;
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(paragraph);
  if (!el) return null;
  return (
    el.textContent?.replace(/Restated →/g, "").replace(/\s+/g, " ").trim().slice(0, 200) ??
    null
  );
}

/** New-side line text for a diff/code range from real hunk rows. */
function hunkRangeText(
  snapshot: ReviewSnapshot,
  fileKey: string,
  start: number,
  end: number,
  aliases: FileKeyAliases,
): string | null {
  const file = resolveFile(snapshot, fileKey, aliases);
  if (!file) return null;
  const rows = new Map<number, HunkLine>();
  for (const hunk of snapshot.files.find((f) => f.fileKey === file.fileKey)?.hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.newLine !== undefined && !rows.has(line.newLine)) rows.set(line.newLine, line);
    }
  }
  const out: string[] = [];
  for (let i = start; i <= Math.min(end, start + 3); i++) {
    const line = rows.get(i);
    if (line !== undefined) out.push(line.text);
  }
  return out.length ? out.join("\n") : null;
}

function shortLabel(path: string, start: number, end: number): string {
  const name = path.split("/").pop() ?? path;
  const range = start === end ? `${start}` : `${start}–${end}`;
  return `${name}:${range}`;
}

/** Resolve one citation to its hover-preview content. */
export function resolveCitation(
  snapshot: ReviewSnapshot,
  citation: Citation,
  aliases: FileKeyAliases = {},
): ResolvedCitation {
  const { target } = citation;
  const parsed = parseId(target);
  if (!parsed) return { target, label: target, snippet: "", unverified: citation.unverified };

  if (parsed.kind === "doc") {
    const block = snapshot.document?.blocks.find((b) => b.id === parsed.blockId);
    return {
      target,
      label: `Document · ${parsed.blockId}`,
      snippet: block ? documentBlockText(block).slice(0, 200) : "",
      unverified: citation.unverified ?? (block ? undefined : true),
    };
  }
  if (parsed.kind === "desc") {
    return {
      target,
      label: descriptionPaneName(snapshot),
      snippet: descText(snapshot, parsed.paragraph) ?? "",
      unverified: citation.unverified,
    };
  }
  if (parsed.kind === "diff") {
    const file = resolveFile(snapshot, parsed.fileKey, aliases);
    const snippet =
      hunkRangeText(snapshot, parsed.fileKey, parsed.start, parsed.end, aliases) ?? "";
    return {
      target,
      label: file ? shortLabel(file.path, parsed.start, parsed.end) : target,
      snippet,
      unverified: citation.unverified,
    };
  }
  if (parsed.kind === "code") {
    // The path and range come from the ID itself, so the label reads
    // the same whether or not the file is in the diff (#81). The
    // snippet comes from hunk rows when the file is in the diff; the
    // hover fetches the cited lines at the commit otherwise.
    const snippet =
      hunkRangeText(snapshot, parsed.path, parsed.start, parsed.end, aliases) ?? "";
    return {
      target,
      label: shortLabel(parsed.path, parsed.start, parsed.end),
      snippet,
      unverified: citation.unverified,
    };
  }
  if (parsed.kind === "h") {
    // The id carries the file key (finding 13): label the hunk by file
    // (+ its line range when the hunk is still in the snapshot), never
    // by content hash.
    const file = resolveFile(snapshot, parsed.fileKey, aliases);
    if (!file) return { target, label: target, snippet: "", unverified: citation.unverified };
    const hunk = (snapshot.files.find((f) => f.fileKey === file.fileKey)?.hunks ?? []).find(
      (h) => h.contentHash === parsed.contentHash,
    );
    const name = file.path.split("/").pop() ?? file.path;
    return {
      target,
      label: hunk ? shortLabel(file.path, hunk.newStart, hunk.newEnd) : name,
      snippet: "",
      unverified: citation.unverified,
    };
  }
  return { target, label: target, snippet: "", unverified: citation.unverified };
}

/** Resolve all citations of a block, in order. */
export function resolveBlockCitations(
  snapshot: ReviewSnapshot,
  citations: Citation[],
  aliases: FileKeyAliases = {},
): ResolvedCitation[] {
  return citations.map((c) => resolveCitation(snapshot, c, aliases));
}

/**
 * Canonicalize a reveal target: map alias-form `diff:` keys to the real
 * file key so the diff pane (which renders canonical ids) highlights.
 * Non-diff targets pass through unchanged.
 */
export function canonicalRevealTarget(
  snapshot: ReviewSnapshot,
  target: string,
  aliases: FileKeyAliases = {},
): string {
  const parsed = parseId(target);
  if (!parsed || parsed.kind !== "diff") return target;
  const file = resolveFile(snapshot, parsed.fileKey, aliases);
  if (!file || file.fileKey === parsed.fileKey) return target;
  const range = parsed.start === parsed.end ? `${parsed.start}` : `${parsed.start}-${parsed.end}`;
  const sha = parsed.sha ? `@${parsed.sha}` : "";
  return `diff:${file.fileKey}:${range}${sha}`;
}
