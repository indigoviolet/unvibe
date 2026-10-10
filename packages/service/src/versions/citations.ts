/**
 * Citation remapping across versions (PRD §8: cards, findings).
 *
 * Rewrites `h:` / `diff:` / `code:` targets to the new version and reports
 * whether a cited hunk changed (for stale badges). Pure: no git, no store.
 */
import { parseId, formatId } from "@unvibe/shared";
import type { Block, Card, Citation, ReviewFile } from "@unvibe/shared";
import type { HunkComparison } from "./compare.js";

export interface CitationCtx {
  comparison: HunkComparison;
  oldFiles: ReviewFile[];
  newHeadSha: string;
}

const oldById = (c: HunkComparison): Map<string, "unchanged" | "changed" | "removed"> => {
  const m = new Map<string, "unchanged" | "changed" | "removed">();
  for (const u of c.unchanged) m.set(u.oldId, "unchanged");
  for (const ch of c.changed) m.set(ch.oldId, "changed");
  for (const r of c.removed) m.set(r.id, "removed");
  return m;
};

function newIdForOld(oldId: string, c: HunkComparison): string | undefined {
  const u = c.unchanged.find((x) => x.oldId === oldId);
  if (u) return u.newId;
  const ch = c.changed.find((x) => x.oldId === oldId);
  if (ch) return ch.newId;
  return undefined;
}

function findOldHunk(fileKey: string, start: number, end: number, oldFiles: ReviewFile[]):
  | { file: ReviewFile; hunk: ReviewFile["hunks"][number] }
  | undefined {
  for (const f of oldFiles) {
    if (f.fileKey !== fileKey) continue;
    for (const h of f.hunks) {
      if (start <= h.newEnd && end >= h.newStart) return { file: f, hunk: h };
    }
  }
  return undefined;
}

/**
 * Remap one citation target. Returns the new target plus whether the cited
 * hunk changed (stale signal). Unknown kinds pass through unchanged.
 */
export function remapCitationTarget(target: string, ctx: CitationCtx): { target: string; changed: boolean } {
  const parsed = parseId(target);
  if (!parsed) return { target, changed: false };
  const statusById = oldById(ctx.comparison);

  if (parsed.kind === "h") {
    const oldId = `h:${parsed.fileKey}:${parsed.contentHash}`;
    const status = statusById.get(oldId);
    if (status === undefined) return { target, changed: false };
    if (status === "unchanged") {
      const nid = newIdForOld(oldId, ctx.comparison);
      return { target: nid ?? target, changed: false };
    }
    // Changed or removed: point at the new hunk when there is one, flag stale.
    const nid = newIdForOld(oldId, ctx.comparison);
    return { target: nid ?? target, changed: true };
  }

  if (parsed.kind === "diff") {
    const found = findOldHunk(parsed.fileKey, parsed.start, parsed.end, ctx.oldFiles);
    if (!found) {
      // Unknown hunk: still bump the SHA so the stored ref keeps its suffix.
      if (!parsed.sha || parsed.sha === ctx.newHeadSha) return { target, changed: false };
      return {
        target: formatId({ kind: "diff", fileKey: parsed.fileKey, start: parsed.start, end: parsed.end, sha: ctx.newHeadSha }),
        changed: false,
      };
    }
    const oldId = `h:${found.file.fileKey}:${found.hunk.contentHash}`;
    const status = statusById.get(oldId);
    if (status === "unchanged") {
      const u = ctx.comparison.unchanged.find((x) => x.oldId === oldId)!;
      const shift = u.lineShift;
      return {
        target: formatId({
          kind: "diff",
          fileKey: u.newHunk.fileKey,
          start: parsed.start + shift,
          end: parsed.end + shift,
          sha: ctx.newHeadSha,
        }),
        changed: false,
      };
    }
    if (status === "changed") {
      const ch = ctx.comparison.changed.find((x) => x.oldId === oldId)!;
      // Point at the new hunk's range; the card prose is stale.
      return {
        target: formatId({
          kind: "diff",
          fileKey: ch.newHunk.fileKey,
          start: ch.newHunk.newStart,
          end: ch.newHunk.newEnd,
          sha: ctx.newHeadSha,
        }),
        changed: true,
      };
    }
    // Removed: keep the old location, flag stale.
    return { target, changed: true };
  }

  if (parsed.kind === "code") {
    // Rename-aware path update + SHA bump; overlap with a changed hunk flags stale.
    let newPath = parsed.path;
    for (const r of ctx.comparison.renames) {
      if (r.oldPath === parsed.path) {
        newPath = r.newPath;
        break;
      }
    }
    let changed = false;
    for (const f of ctx.oldFiles) {
      if (f.path !== parsed.path && f.oldPath !== parsed.path) continue;
      for (const h of f.hunks) {
        if (parsed.start <= h.newEnd && parsed.end >= h.newStart) {
          const oldId = `h:${f.fileKey}:${h.contentHash}`;
          const st = statusById.get(oldId);
          if (st === "changed" || st === "removed") changed = true;
        }
      }
    }
    const newTarget = formatId({
      kind: "code",
      path: newPath,
      start: parsed.start,
      end: parsed.end,
      sha: ctx.newHeadSha,
    });
    return { target: newTarget, changed };
  }

  return { target, changed: false };
}

/** All citations on a card (block-level, list items, aside inners). */
export function cardCitations(card: Card): Citation[] {
  const out: Citation[] = [];
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      switch (b.type) {
        case "paragraph":
        case "table":
        case "code":
        case "diagram":
        case "finding-link":
        case "follow-up":
          out.push(...b.citations);
          break;
        case "list":
          out.push(...b.citations);
          for (const item of b.items) out.push(...item.citations);
          break;
        case "aside":
          out.push(...b.citations);
          walk(b.inner);
          break;
      }
    }
  };
  walk(card.blocks);
  return out;
}

/**
 * Rewrite every citation on a card in place (for `ReviewStore.mutate`
 * drafts). Returns the number of citations whose hunk changed.
 */
export function remapCardCitations(card: Card, ctx: CitationCtx): number {
  let changed = 0;
  const fix = (c: Citation): void => {
    const r = remapCitationTarget(c.target, ctx);
    c.target = r.target;
    if (r.changed) changed += 1;
  };
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      switch (b.type) {
        case "paragraph":
        case "table":
        case "code":
        case "diagram":
        case "finding-link":
        case "follow-up":
          b.citations.forEach(fix);
          break;
        case "list":
          b.citations.forEach(fix);
          for (const item of b.items) item.citations.forEach(fix);
          break;
        case "aside":
          b.citations.forEach(fix);
          walk(b.inner);
          break;
      }
    }
  };
  walk(card.blocks);
  return changed;
}
