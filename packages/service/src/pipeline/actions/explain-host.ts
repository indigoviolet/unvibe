/**
 * Anchor host equality for dedupe/reuse checks (explain + ask share it).
 */
import type { Annotation } from "@unvibe/shared";

export function anchorSameHost(a: Annotation["anchor"], b: Annotation["anchor"]): boolean {
  if (a.host.kind !== b.host.kind) return false;
  if (a.host.kind === "block" && b.host.kind === "block") return a.host.blockId === b.host.blockId;
  if (a.host.kind === "description" && b.host.kind === "description") return a.host.paragraphId === b.host.paragraphId;
  if (a.host.kind === "diff-line" && b.host.kind === "diff-line") {
    return a.host.fileKey === b.host.fileKey && a.host.line === b.host.line;
  }
  if (a.host.kind === "hunk" && b.host.kind === "hunk") {
    return a.host.fileKey === b.host.fileKey && a.host.contentHash === b.host.contentHash;
  }
  if (a.host.kind === "comment" && b.host.kind === "comment") return a.host.commentId === b.host.commentId;
  return false;
}
