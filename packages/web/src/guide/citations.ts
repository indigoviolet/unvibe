/**
 * Citation preview resolution (M2, web-guide owner).
 *
 * Order: live snapshot rows first (the diff agent's data), then the
 * description paragraphs, then the mock `prototypeLines.ts` fallback.
 * Returns `{ label, snippet }` per target for the hover popover; unknown
 * targets resolve to a label with an empty snippet (never a crash).
 */
import type { Citation, ReviewSnapshot } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import { mockDescSnippets, mockDiffLines, mockSourceLabel } from "../mock/prototypeLines.js";

export interface ResolvedCitation {
  target: string;
  label: string;
  snippet: string;
  unverified?: boolean;
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

function diffLines(snapshot: ReviewSnapshot, fileKey: string, start: number, end: number): string[] | null {
  const file = snapshot.files.find((f) => f.fileKey === fileKey);
  void file;
  // Snapshot `ReviewFile` carries hunks without row text in M2, so line text
  // comes from the mock table until the diff agent exposes row content.
  // (Kept as a function of the snapshot so the real lookup lands here.)
  const out: string[] = [];
  for (let i = start; i <= Math.min(end, start + 3); i++) {
    const line = mockDiffLines[`${fileKey}:${i}`];
    if (line !== undefined) out.push(line);
  }
  return out.length ? out : null;
}

function sourceLabel(snapshot: ReviewSnapshot, target: string): string {
  const parsed = parseId(target);
  if (!parsed) return target;
  if (parsed.kind === "desc") return "PR description";
  if (parsed.kind === "diff" || parsed.kind === "code") {
    const fileKey = parsed.kind === "diff" ? parsed.fileKey : parsed.path;
    const file = snapshot.files.find((f) => f.fileKey === fileKey);
    const name = file?.path.split("/").pop() ?? mockSourceLabel(target).split(":")[0];
    const range =
      parsed.start === parsed.end ? `${parsed.start}` : `${parsed.start}–${parsed.end}`;
    return parsed.kind === "diff" ? `${name}:${range}` : `${parsed.path}:${range}`;
  }
  if (parsed.kind === "h") return `hunk ${parsed.contentHash.slice(0, 8)}`;
  return target;
}

/** Resolve one citation to its hover-preview content. */
export function resolveCitation(snapshot: ReviewSnapshot, citation: Citation): ResolvedCitation {
  const { target } = citation;
  const label = sourceLabel(snapshot, target);
  const parsed = parseId(target);
  let snippet = "";
  if (parsed?.kind === "desc") {
    snippet = descText(snapshot, parsed.paragraph) ?? mockDescSnippets[parsed.paragraph] ?? "";
  } else if (parsed?.kind === "diff" || parsed?.kind === "code") {
    const fileKey = parsed.kind === "diff" ? parsed.fileKey : parsed.path;
    snippet = diffLines(snapshot, fileKey, parsed.start, parsed.end)?.join("\n") ?? "";
    if (!snippet && parsed.kind === "diff" && parsed.start === parsed.end) {
      snippet = mockDiffLines[`${fileKey}:${parsed.start}`] ?? "";
    }
  }
  return { target, label, snippet, unverified: citation.unverified };
}

/** Resolve all citations of a block, in order. */
export function resolveBlockCitations(
  snapshot: ReviewSnapshot,
  citations: Citation[],
): ResolvedCitation[] {
  return citations.map((c) => resolveCitation(snapshot, c));
}
