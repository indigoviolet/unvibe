/**
 * Cited-code excerpts for second opinions (PRD §12).
 *
 * The second-opinion session sees L0 + L1 + only the cited code. This
 * module builds the excerpt map from the live snapshot (diff hunks,
 * description paragraphs) plus the worktree for `code:` IDs outside the
 * diff. Only excerpts whose ID is cited are included downstream (see
 * `buildSecondOpinionContext`); everything else is dropped.
 */
import { parseId, type ReviewSnapshot } from "@unvibe/shared";
import type { CodeExcerpt } from "../context/index.js";
import type { CommandRunner } from "../exec/index.js";

export interface ExcerptDeps {
  snapshot: ReviewSnapshot;
  /** Absolute worktree path for `code:` reads (null when unavailable). */
  worktreePath?: string | null;
  commands?: CommandRunner;
}

function formatHunkExcerpt(
  fileKey: string,
  path: string,
  header: string,
  contentHash: string,
  lines: { kind: string; oldLine?: number; newLine?: number; text: string }[],
  slice?: { start: number; end: number },
): string {
  const rows: string[] = [];
  for (const l of lines) {
    const newNo = l.newLine;
    if (slice && newNo !== undefined && (newNo < slice.start || newNo > slice.end)) {
      // For `diff:` ranges, keep a couple of context lines around the slice
      // so the excerpt reads as code, not fragments.
      continue;
    }
    if (l.kind === "del") rows.push(`o${l.oldLine ?? "?"} - ${l.text}`);
    else rows.push(`n${newNo ?? "?"} ${l.kind === "add" ? "+" : " "} ${l.text}`);
  }
  return [`h:${fileKey}:${contentHash}`, `file: ${path}`, header, ...rows].join("\n");
}

function descTextOf(html: string, paragraphId: string): string | null {
  if (!html) return null;
  const re = new RegExp(`id="${paragraphId}"[^>]*>([\\s\\S]*?)<\\/`, "i");
  const m = html.match(re);
  if (m) {
    return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

/**
 * Build all available excerpts, keyed by citation ID. Callers pass this
 * plus the card's cited IDs into `buildSecondOpinionContext`, which keeps
 * only the cited ones (structural isolation).
 */
export async function buildExcerptMap(deps: ExcerptDeps): Promise<CodeExcerpt[]> {
  const { snapshot } = deps;
  const out: CodeExcerpt[] = [];

  for (const f of snapshot.files) {
    for (const h of f.hunks) {
      const id = `h:${f.fileKey}:${h.contentHash}`;
      out.push({
        id,
        text: formatHunkExcerpt(f.fileKey, f.path, h.header, h.contentHash, h.lines),
      });
      // Also index the hunk's full new-side range as a `diff:` ID so
      // `diff:<fileKey>:<start>-<end>` citations resolve to the same text.
      const rangeId = `diff:${f.fileKey}:${h.newStart}-${h.newEnd}`;
      out.push({
        id: rangeId,
        text: formatHunkExcerpt(f.fileKey, f.path, h.header, h.contentHash, h.lines),
      });
      // Short single-line form for convenience.
      for (const l of h.lines) {
        if (l.newLine !== undefined) {
          const single = `diff:${f.fileKey}:${l.newLine}`;
          if (!out.some((e) => e.id === single)) {
            out.push({
              id: single,
              text: formatHunkExcerpt(
                f.fileKey,
                f.path,
                h.header,
                h.contentHash,
                h.lines,
                { start: l.newLine, end: l.newLine },
              ),
            });
          }
        }
      }
    }
  }

  // Description paragraphs (already in L1, but explicit excerpts help the
  // check-mode claim that cites `desc:` IDs).
  if (snapshot.description?.html) {
    const html = snapshot.description.html;
    const ids = new Set<string>();
    for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
    for (const id of ids) {
      const text = descTextOf(html, id);
      if (text) {
        const rev = snapshot.description.rev;
        out.push({ id: `desc:${id}`, text });
        if (rev) out.push({ id: `desc:${id}@${rev}`, text });
      }
    }
  }

  // Pinned excerpts (main model's pins that overlap cited ranges are fair
  // game only when cited — uncited pins are dropped downstream).
  for (const p of snapshot.pinnedCode ?? []) {
    const range = p.start === p.end ? `${p.start}` : `${p.start}-${p.end}`;
    const full = `code:${p.path}:${range}@${p.sha}`;
    const short = `code:${p.path}:${range}`;
    const text = p.text || `(pinned ${p.path}:${range})`;
    out.push({ id: full, text });
    out.push({ id: short, text });
  }

  return out;
}

/**
 * Resolve `code:` excerpts that are not in the diff by reading the
 * worktree (`git show <sha>:<path>`). Returns additional excerpts; failures
 * are silent (the ID lands in `missingIds` downstream, and the model can
 * still fetch it with `get_code`).
 */
export async function readCodeExcerpts(
  citedIds: string[],
  headSha: string,
  worktreePath: string | null | undefined,
  commands: CommandRunner | undefined,
): Promise<CodeExcerpt[]> {
  if (!worktreePath || !commands) return [];
  const out: CodeExcerpt[] = [];
  const seen = new Set<string>();
  for (const id of citedIds) {
    const parsed = parseId(id);
    if (!parsed || parsed.kind !== "code") continue;
    // `code:<path>:<line>[-<line>][@<sha>]`
    const m = id.match(/^code:(.+):(\d+)(?:-(\d+))?(?:@(.+))?$/);
    if (!m) continue;
    const relPath = m[1];
    const start = Number(m[2]);
    const end = m[3] === undefined ? start : Number(m[3]);
    const sha = m[4] ?? headSha;
    const key = `${relPath}:${start}-${end}@${sha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const res = await commands.run("git", {
        args: ["show", `${sha}:${relPath}`],
        cwd: worktreePath,
      });
      if (res.code !== 0) continue;
      const all = res.stdout.split("\n");
      if (end > all.length) continue;
      const slice = all.slice(start - 1, end);
      const text = [
        `code:${relPath}:${start === end ? `${start}` : `${start}-${end}`}@${sha}`,
        ...slice.map((line, i) => `${start + i}: ${line}`),
      ].join("\n");
      out.push({ id, text });
      out.push({ id: `code:${relPath}:${start === end ? `${start}` : `${start}-${end}`}`, text });
    } catch {
      // Missing: leave for `missingIds`.
    }
  }
  return out;
}
