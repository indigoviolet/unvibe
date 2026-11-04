/**
 * Since-B baseline computation (issue #351 step 1).
 *
 * "Since B" is computed by hunk-content comparison between the stored
 * version diffs (the existing §8 `compareHunks`), never git ancestry —
 * so a rebased B, where B is not an ancestor of the head, works the
 * same as a fast-forward one. Pure functions over snapshots + stored
 * `ReviewFile` lists; git and routing stay out.
 */
import type {
  Card,
  ExistingReviewComment,
  PrConversationRemark,
  ReviewCommit,
  ReviewFile,
  ReviewSnapshot,
  SinceBaseline,
  SinceFeedbackLink,
  SinceFeedbackRef,
  SinceHunks,
} from "@unvibe/shared";
import {
  classifyFile,
  fileKeyForPath,
  isCommitSha,
  isSinceBaseline,
  shortBaselineSha,
  sinceBaselineLabel,
} from "@unvibe/shared";
import { compareHunks, hunkId } from "./compare.js";
import type { CommandRunner } from "../exec/index.js";
import { hashHunkLines, parseUnifiedDiff } from "../ingest/index.js";

/** New-side `h:` IDs changed or added between two stored diffs. Pure. */
export function computeSinceHunks(bFiles: ReviewFile[], curFiles: ReviewFile[]): SinceHunks {
  const cmp = compareHunks(bFiles, curFiles);
  return {
    changed: cmp.changed.map((c) => c.newId),
    added: cmp.added.map((a) => a.id),
  };
}

/**
 * Baseline the next update pass (or the still-pending guide run) explains
 * from: the stored pick — a version or a commit sha — or the version last
 * opened (the refresh's `fromVersion`) when nothing was picked. Pure.
 */
export function resolveSinceBaseline(snapshot: ReviewSnapshot): SinceBaseline {
  const stored = snapshot.sinceBaseline;
  if (isSinceBaseline(stored)) {
    return stored.kind === "version" ? { kind: "version", version: stored.version } : { kind: "commit", sha: stored.sha };
  }
  const from = snapshot.versionStatus?.fromVersion;
  const cur = snapshot.review.currentVersion;
  const fallback = typeof from === "number" && from >= 1 && from < cur ? from : Math.max(1, cur - 1);
  return { kind: "version", version: fallback };
}

/** Version row (fetchedAt/headSha) for the window matching below. */
function versionRow(
  snapshot: ReviewSnapshot,
  n: number,
): { headSha: string; fetchedAt: number } | null {
  if (snapshot.version?.n === n) {
    return { headSha: snapshot.version.headSha, fetchedAt: snapshot.version.fetchedAt };
  }
  const row = snapshot.review.versions.find((v) => v.n === n);
  return row ? { headSha: row.headSha, fetchedAt: row.fetchedAt } : null;
}

/** New-side line ranges of the since hunks, per file path. */
function sinceRanges(
  curFiles: ReviewFile[],
  sinceIds: Set<string>,
): Map<string, { start: number; end: number }[]> {
  const out = new Map<string, { start: number; end: number }[]>();
  for (const f of curFiles) {
    for (const h of f.hunks) {
      if (!sinceIds.has(hunkId(f.fileKey, h.contentHash))) continue;
      const list = out.get(f.path) ?? [];
      list.push({ start: h.newStart, end: h.newEnd });
      out.set(f.path, list);
    }
  }
  return out;
}

/** Epoch ms, or null when the timestamp is missing/unparseable. */
function timeOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export interface SinceCommentMatch {
  comment: ExistingReviewComment;
  /** New-side `h:` IDs whose file + line range holds the comment. */
  hunkIds: string[];
}

export interface SinceThreadMatch {
  threadId: string;
  excerpt: string;
  /** New-side `h:` IDs the thread's diff anchor overlaps, when any. */
  hunkIds: string[];
  commentCount: number;
}

export interface SinceFeedback {
  comments: SinceCommentMatch[];
  threads: SinceThreadMatch[];
  commits: ReviewCommit[];
  conversation: PrConversationRemark[];
  baseline: SinceBaseline;
  headVersion: number;
  windowStart: number | null;
  windowEnd: number | null;
}

const MAX_COMMENT_MATCHES = 20;
const MAX_THREAD_MATCHES = 10;
const MAX_CONVERSATION_MATCHES = 10;

function excerpt(text: string, cap: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > cap ? `${oneLine.slice(0, cap)}…` : oneLine;
}

/**
 * Feedback the delta since B may answer: existing inline review comments
 * matched by file + line (in a since hunk's new-side range) and time
 * (between B and head when timestamps exist), local comment threads
 * anchored on overlapping diff lines, the commits touching since hunks
 * (their messages say why), and PR conversation remarks in the window.
 * Pure. Capped so the prompt variable stays small.
 */
export function matchSinceFeedback(snapshot: ReviewSnapshot, since: SinceHunks): SinceFeedback {
  const baseline = resolveSinceBaseline(snapshot);
  const headVersion = snapshot.review.currentVersion;
  const bRow = baseline.kind === "version" ? versionRow(snapshot, baseline.version) : null;
  const headRow = versionRow(snapshot, headVersion);
  // A commit baseline carries no stored timestamp (the commit's date is
  // not kept on the snapshot), so there is no lower time bound: every
  // remark on a since hunk counts. An old remark on a reworked line is
  // plausibly what the rework answers.
  const windowStart = bRow?.fetchedAt ?? null;
  const windowEnd = headRow?.fetchedAt ?? null;

  const sinceIds = new Set([...since.added, ...since.changed]);
  const ranges = sinceRanges(snapshot.files ?? [], sinceIds);
  const inWindow = (iso: string | undefined): boolean => {
    const t = timeOf(iso);
    if (t === null) return true;
    if (windowStart !== null && t < windowStart) return false;
    if (windowEnd !== null && t > windowEnd) return false;
    return true;
  };
  const hunkIdsAt = (filePath: string, line: number): string[] => {
    const out: string[] = [];
    for (const f of snapshot.files) {
      if (f.path !== filePath) continue;
      for (const h of f.hunks) {
        const id = hunkId(f.fileKey, h.contentHash);
        if (sinceIds.has(id) && line >= h.newStart && line <= h.newEnd) out.push(id);
      }
    }
    return out;
  };

  const comments: SinceCommentMatch[] = [];
  for (const c of snapshot.existingComments ?? []) {
    if (c.path === undefined || c.line === undefined) continue;
    if (!ranges.has(c.path)) continue;
    if (!inWindow(c.createdAt)) continue;
    const hunkIds = hunkIdsAt(c.path, c.line);
    if (hunkIds.length === 0) continue;
    comments.push({ comment: c, hunkIds });
    if (comments.length >= MAX_COMMENT_MATCHES) break;
  }

  const threads: SinceThreadMatch[] = [];
  for (const t of snapshot.annotations ?? []) {
    if (t.anchor.host.kind !== "diff-line") continue;
    const { fileKey, line } = t.anchor.host;
    const owner = snapshot.files.find((f) => f.fileKey === fileKey);
    if (!owner) continue;
    if (!ranges.has(owner.path)) continue;
    const hunkIds = hunkIdsAt(owner.path, line);
    if (hunkIds.length === 0) continue;
    const commentReplies = t.replies.filter((r) => r.kind === "comment");
    if (commentReplies.length === 0) continue;
    const first = commentReplies[0];
    const firstPara = first?.blocks.find((b) => b.type === "paragraph");
    const text =
      firstPara && firstPara.type === "paragraph" ? firstPara.text.standard : t.anchor.quotedText;
    threads.push({
      threadId: t.id,
      excerpt: excerpt(text, 160),
      hunkIds,
      commentCount: commentReplies.length,
    });
    if (threads.length >= MAX_THREAD_MATCHES) break;
  }

  const commits = (snapshot.commits ?? []).filter((c) => c.hunks.some((h) => sinceIds.has(h)));

  const conversation = (snapshot.prConversation ?? []).filter((r) => inWindow(r.createdAt)).slice(
    0,
    MAX_CONVERSATION_MATCHES,
  );

  return { comments, threads, commits, conversation, baseline, headVersion, windowStart, windowEnd };
}

/**
 * Resolve the agent's feedback pointers against the snapshot into
 * renderable links. Unknown ids are dropped; the list is capped.
 * Pure. Comment/thread/conversation remarks link out (stored URL) or
 * to the thread on the page; commits render as text (no stable URL).
 */
export function resolveSinceAnswers(
  snapshot: ReviewSnapshot,
  refs: SinceFeedbackRef[] | undefined,
): SinceFeedbackLink[] {
  if (!refs) return [];
  const out: SinceFeedbackLink[] = [];
  for (const r of refs.slice(0, 5)) {
    if (typeof r !== "object" || r === null || typeof r.id !== "string" || r.id.length === 0) continue;
    if (r.kind === "comment") {
      const c = (snapshot.existingComments ?? []).find((x) => String(x.id) === r.id);
      if (!c) continue;
      out.push({
        kind: "comment",
        label: `@${c.author ?? "unknown"} on ${c.path ?? "?"}:${c.line ?? "?"}`,
        excerpt: excerpt(c.body, 160),
        ...(c.htmlUrl ? { url: c.htmlUrl } : {}),
      });
    } else if (r.kind === "thread") {
      const t = (snapshot.annotations ?? []).find((x) => x.id === r.id);
      if (!t) continue;
      const first = t.replies.find((x) => x.kind === "comment");
      const para = first?.blocks.find((b) => b.type === "paragraph");
      const text = para && para.type === "paragraph" ? para.text.standard : t.anchor.quotedText;
      out.push({ kind: "thread", label: `Thread ${t.id}`, excerpt: excerpt(text, 160), url: `#${t.id}` });
    } else if (r.kind === "conversation") {
      const m = (snapshot.prConversation ?? []).find((x) => String(x.id) === r.id);
      if (!m) continue;
      out.push({
        kind: "conversation",
        label: m.author ? `PR conversation by @${m.author}` : "PR conversation",
        excerpt: excerpt(m.body, 160),
        ...(m.htmlUrl ? { url: m.htmlUrl } : {}),
      });
    } else if (r.kind === "commit") {
      const c = (snapshot.commits ?? []).find((x) => x.sha === r.id || x.sha.startsWith(r.id));
      if (!c) continue;
      const body = (c.body ?? "").trim().split("\n")[0] ?? "";
      out.push({
        kind: "commit",
        label: `${c.sha.slice(0, 8)} ${c.subject}`,
        excerpt: excerpt(body.length > 0 ? body : c.subject, 160),
      });
    }
  }
  return out;
}

/**
 * True when the value looks like an agent-written feedback pointer.
 * Pure. Used by the update-pass parser before service-side resolution.
 */
export function isSinceFeedbackRef(v: unknown): v is SinceFeedbackRef {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o["kind"] === "comment" ||
      o["kind"] === "thread" ||
      o["kind"] === "conversation" ||
      o["kind"] === "commit") &&
    typeof o["id"] === "string" &&
    (o["id"] as string).length > 0
  );
}

/** Short `v3 · abc1234 · 4 Nov` label for prompts and the UI. Pure. */
export function versionLabel(n: number, headSha: string, fetchedAt: number): string {
  const date = new Date(fetchedAt);
  const day = date.getUTCDate();
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `v${n} · ${headSha.slice(0, 8)} · ${day} ${month}`;
}

/**
 * Render the `{{since_context}}` update-pass variable: baseline identity,
 * the commits since B (why, from their messages), and the matched
 * feedback (review comments, threads, conversation remarks). Pure.
 */
/**
 * The baseline's identity for prompts: the version label (`v1 · abc12345
 * · 4 Nov`) or the commit's short sha with its subject when the commit is
 * one of the PR's (`abc12345 "rework alpha"`). Pure.
 */
export function baselineIdentity(snapshot: ReviewSnapshot, baseline: SinceBaseline): string {
  if (baseline.kind === "version") {
    const row = versionRow(snapshot, baseline.version);
    return row ? versionLabel(baseline.version, row.headSha, row.fetchedAt) : `v${baseline.version}`;
  }
  const known = snapshot.commits?.find((c) => c.sha === baseline.sha || c.sha.startsWith(baseline.sha));
  const subject = known ? ` "${known.subject}"` : "";
  return `${shortBaselineSha(baseline.sha)}${subject}`;
}

export function formatSinceContext(snapshot: ReviewSnapshot, since: SinceHunks): string {
  const fb = matchSinceFeedback(snapshot, since);
  const baseline = fb.baseline;
  const bRow = baseline.kind === "version" ? versionRow(snapshot, baseline.version) : null;
  const headRow = versionRow(snapshot, fb.headVersion);
  const lines: string[] = [];
  lines.push("## Baseline");
  if (bRow && headRow && baseline.kind === "version") {
    lines.push(
      `B is ${versionLabel(baseline.version, bRow.headSha, bRow.fetchedAt)}; ` +
        `head is ${versionLabel(fb.headVersion, headRow.headSha, headRow.fetchedAt)}. ` +
        `Explain only the ${since.changed.length} changed + ${since.added.length} new hunks since B.`,
    );
  } else if (baseline.kind === "commit") {
    const head = headRow
      ? versionLabel(fb.headVersion, headRow.headSha, headRow.fetchedAt)
      : `v${fb.headVersion}`;
    lines.push(
      `B is commit ${baselineIdentity(snapshot, fb.baseline)}; ` +
        `head is ${head}. ` +
        `Explain only the ${since.changed.length} changed + ${since.added.length} new hunks since B.`,
    );
  } else if (baseline.kind === "version") {
    lines.push(
      `B is v${baseline.version}; head is v${fb.headVersion}. ` +
        `Explain only the ${since.changed.length} changed + ${since.added.length} new hunks since B.`,
    );
  }
  lines.push("");
  lines.push("## Commits since B (why, from their messages)");
  if (fb.commits.length === 0) {
    lines.push("(no commit touches the hunks since B)");
  } else {
    for (const c of fb.commits.slice(0, 30)) {
      lines.push(`- [commit ${c.sha}] ${c.sha.slice(0, 8)} ${c.subject}`);
      const body = (c.body ?? "").trim().split("\n").slice(0, 3).join("\n").trim();
      if (body) lines.push(`  ${body.split("\n").join("\n  ")}`);
    }
  }
  lines.push("");
  lines.push("## Feedback this delta may answer");
  lines.push("Each item's bracketed id goes in the `answers` list of the card or addendum that answers it.");
  const remarks: string[] = [];
  for (const m of fb.comments) {
    const when = m.comment.createdAt ?? "undated";
    remarks.push(
      `- [comment ${m.comment.id}] PR review comment by @${m.comment.author ?? "unknown"} on ${m.comment.path}:${m.comment.line} (${when}): ` +
        `"${excerpt(m.comment.body, 200)}" → ${m.hunkIds.join(", ")}`,
    );
  }
  for (const t of fb.threads) {
    remarks.push(
      `- [thread ${t.threadId}] Local thread (${t.commentCount} comment${t.commentCount === 1 ? "" : "s"}): ` +
        `"${t.excerpt}" → ${t.hunkIds.join(", ")}`,
    );
  }
  for (const r of fb.conversation) {
    const when = r.createdAt ?? "undated";
    remarks.push(
      `- [conversation ${r.id}] PR conversation remark by @${r.author ?? "unknown"} (${when}): ` +
        `"${excerpt(r.body, 200)}"`,
    );
  }
  lines.push(remarks.length > 0 ? remarks.join("\n") : "(no review comment, thread or conversation remark matched the delta)");
  return lines.join("\n");
}

/**
 * Issue #351 step 2: the diff at a commit B as `ReviewFile[]` — the
 * other side of the commit-baseline comparison. Parsed and hashed like
 * any stored diff (same `fileKey` + `contentHash` identity), so
 * `computeSinceHunks` compares it against the head diff by hunk content
 * with no regard for ancestry. Pure over the diff text.
 */
export function buildFilesFromDiffText(diffText: string): ReviewFile[] {
  return parseUnifiedDiff(diffText).map((f) => {
    const fileKey = fileKeyForPath(f.path);
    const category = classifyFile(f.path);
    return {
      fileKey,
      path: f.path,
      category,
      hunks: f.hunks.map((h) => ({
        contentHash: hashHunkLines(h.lines),
        header: h.header,
        ...(h.context !== undefined ? { context: h.context } : {}),
        newStart: h.newStart,
        newEnd: h.newEnd,
        oldStart: h.oldStart,
        oldEnd: h.oldEnd,
        added: h.added,
        removed: h.removed,
        lines: h.lines.map((l) => ({ ...l })),
        ...(h.noNewline ? { noNewline: true as const } : {}),
      })),
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      ...(f.isNew ? { isNew: true as const } : {}),
      ...(f.isDeleted ? { isDeleted: true as const } : {}),
      ...(f.isRename ? { isRename: true as const } : {}),
      ...(f.isBinary ? { isBinary: true as const } : {}),
    };
  });
}

/**
 * Issue #351 step 2: make sure the baseline commit's content is
 * available. A locally known sha passes at once; otherwise one
 * `git fetch origin <sha>` is tried (read-only — GitHub serves any sha
 * this way). Anything else throws a UI-facing error naming the short
 * sha; callers surface it instead of failing silently.
 */
export async function ensureCommitFetchable(
  runner: CommandRunner,
  repoPath: string,
  sha: string,
): Promise<void> {
  const short = shortBaselineSha(sha);
  const known = await runner.run("git", { args: ["cat-file", "-e", sha], cwd: repoPath }).catch(() => null);
  if (known && known.code === 0) return;
  try {
    const fetched = await runner.run("git", { args: ["fetch", "origin", sha], cwd: repoPath });
    if (fetched.code === 0) {
      const again = await runner.run("git", { args: ["cat-file", "-e", sha], cwd: repoPath });
      if (again.code === 0) return;
    }
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error(
    `couldn't find commit ${short} in this checkout or on the remote — ` +
      `it may have been garbage-collected after a force-push`,
  );
}

/**
 * Issue #351 step 2: the `base...B` side of a commit baseline — the
 * merge-base-to-commit diff parsed into `ReviewFile[]` for
 * hunk-content comparison against the head diff. Throws the
 * UI-facing unfetchable error when B is gone.
 */
export async function diffFilesAtCommit(
  runner: CommandRunner,
  repoPath: string,
  mergeBaseSha: string,
  sha: string,
): Promise<ReviewFile[]> {
  await ensureCommitFetchable(runner, repoPath, sha);
  let diff: { ok: boolean; stdout: string };
  try {
    const res = await runner.run("git", {
      args: ["diff", "-U3", "-M", "--no-color", "--no-ext-diff", mergeBaseSha, sha, "--"],
      cwd: repoPath,
    });
    diff = { ok: res.code === 0, stdout: res.stdout };
  } catch {
    diff = { ok: false, stdout: "" };
  }
  if (!diff.ok) {
    throw new Error(
      `couldn't diff ${shortBaselineSha(sha)} against the base — the commit may have been garbage-collected after a force-push`,
    );
  }
  return buildFilesFromDiffText(diff.stdout);
}

/** Agent-shaped since cards with the service-resolved shape. Pure. */
export interface SinceCardDraftWithRefs extends Card {
  answerRefs?: SinceFeedbackRef[];
}

/**
 * Issue #351 step 2: the agent's `answers` pointers arrive as
 * `{ kind, id }` on `answerRefs`; keep only well-formed ones here —
 * resolution against the snapshot (unknown ids dropped) happens in
 * `buildSinceSectionCards` below. Pure.
 */
export function normalizeAgentSinceCards(v: unknown): SinceCardDraftWithRefs[] | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const cards = (v as Record<string, unknown>)["cards"];
  if (!Array.isArray(cards)) return undefined;
  return cards
    .filter((c) => typeof c === "object" && c !== null)
    .map((c) => {
      const card = c as SinceCardDraftWithRefs;
      const raw = (c as unknown as Record<string, unknown>)["answers"];
      if (Array.isArray(raw)) {
        const refs = raw.filter(isSinceFeedbackRef).map((r) => ({ kind: r.kind, id: r.id }));
        if (refs.length > 0) (card as { answerRefs?: SinceFeedbackRef[] }).answerRefs = refs;
        delete (c as unknown as Record<string, unknown>)["answers"];
      }
      return card as SinceCardDraftWithRefs;
    });
}

/**
 * Issue #351 step 2: store the agent-written Since-B cards — fresh
 * unique ids, resolved feedback links (unknown ids dropped at once),
 * canonical card shape. Shared by the update pass and the guide run so
 * both store the same shape. Pure over the snapshot (read-only).
 */
export function buildSinceSectionCards(
  snapshot: ReviewSnapshot,
  cards: SinceCardDraftWithRefs[],
): Card[] {
  const known = new Set(snapshot.pages.flatMap((p) => p.cards.map((c) => c.id)));
  if (snapshot.sinceSection) {
    for (const c of snapshot.sinceSection.cards) known.add(c.id);
  }
  const toVersion = snapshot.review.currentVersion;
  return cards.map((c, i) => {
    let id = typeof c.id === "string" && c.id.length > 0 ? c.id : `since-${toVersion}-${i + 1}`;
    if (known.has(id)) id = `${id}-v${toVersion}`;
    known.add(id);
    const answers = resolveSinceAnswers(snapshot, c.answerRefs);
    const cardOut: Card = {
      ...(c as Card),
      id,
      pageId: typeof c.pageId === "string" && c.pageId.length > 0 ? c.pageId : "since",
      level: c.level === "simple" || c.level === "standard" || c.level === "deep" ? c.level : "standard",
      collapsed: c.collapsed === true,
      revision: typeof c.revision === "number" ? c.revision : 1,
      undoStack: Array.isArray(c.undoStack) ? c.undoStack : [],
      blocks: Array.isArray(c.blocks) ? c.blocks : [],
    };
    const rec = cardOut as unknown as Record<string, unknown>;
    delete rec["answerRefs"];
    delete rec["answers"];
    if (answers.length > 0) cardOut.answers = answers;
    return cardOut;
  });
}

/**
 * Issue #351 step 2: mark plotlines whose every assigned hunk changed
 * since B as `newSinceBaseline` (the guide run names plotlines for the
 * whole PR; the ones covering only post-B hunks are the new threads).
 * Callers pass the draft's plotlines + hunk states and the stored
 * since-hunk set. Returns the marked plotline ids. Pure.
 */
export function markNewSincePlotlines(
  plotlines: { id: string; newSinceBaseline?: boolean }[],
  states: { contentHash: string; plotline?: string }[],
  sinceHashes: Set<string>,
): string[] {
  if (sinceHashes.size === 0) return [];
  const assigned = new Map<string, Set<string>>();
  for (const s of states) {
    if (s.plotline === undefined) continue;
    let set = assigned.get(s.plotline);
    if (!set) {
      set = new Set();
      assigned.set(s.plotline, set);
    }
    set.add(s.contentHash);
  }
  const marked: string[] = [];
  for (const [plotline, hashes] of assigned) {
    if (hashes.size === 0) continue;
    let allSince = true;
    for (const h of hashes) {
      if (!sinceHashes.has(h)) {
        allSince = false;
        break;
      }
    }
    if (!allSince) continue;
    const row = plotlines.find((p) => p.id === plotline);
    if (row && row.newSinceBaseline !== true) {
      row.newSinceBaseline = true;
      marked.push(plotline);
    }
  }
  return marked;
}

/** Max since-hunk ids named in the reader's reviewed context. */
export const READER_SINCE_HUNK_CAP = 200;

/**
 * Issue #351 step 2: the reader prompt's `{{reviewed_context}}` variable.
 * When the reviewer already reviewed this PR on GitHub up to a commit B
 * (accepted before the guide run), the reader is told so, is shown the
 * since-hunk ids to cite and the feedback the delta may answer, and
 * writes the normal guide plus the Since-B section in the same run.
 * Otherwise a one-liner sending it down the normal whole-PR path. Pure.
 */
export function formatReaderReviewedContext(snapshot: ReviewSnapshot, since?: SinceHunks): string {
  const baseline = snapshot.sinceBaseline;
  if (!baseline || baseline.kind !== "commit" || !isCommitSha(baseline.sha)) {
    return "(No prior-review baseline: explain the whole change; write no Since-B section.)";
  }
  const lines: string[] = [];
  lines.push("## Reviewed up to B");
  lines.push(
    `The reviewer has already reviewed this PR on GitHub up to commit ${baselineIdentity(snapshot, baseline)} ` +
      `(their latest GitHub review). ` +
      `Write the normal guide for the whole PR, then add the Since-B section below.`,
  );
  lines.push("");
  lines.push("## Since hunks (cite these in the Since-B cards)");
  if (since === undefined) {
    lines.push(
      "(the since-hunk comparison is unavailable — B could not be diffed: " +
        "write the normal guide and no Since-B section)",
    );
  } else {
    const ids = [...since.changed, ...since.added];
    const kept = ids.slice(0, READER_SINCE_HUNK_CAP);
    const omitted = ids.length - kept.length;
    if (kept.length === 0) {
      lines.push("(no hunks changed since B — B is the head or its content matches the head: write no Since-B section)");
    } else {
      lines.push(kept.join(", "));
      if (omitted > 0) lines.push(`(+${omitted} more since hunks, all in the diff above)`);
    }
  }
  lines.push("");
  lines.push("## Feedback the delta since B may answer");
  lines.push("Each item's bracketed id goes in the `answers` list of the Since-B card that answers it.");
  const fb = matchSinceFeedback(snapshot, since ?? { added: [], changed: [] });
  const remarks: string[] = [];
  for (const m of fb.comments) {
    remarks.push(
      `- [comment ${m.comment.id}] PR review comment by @${m.comment.author ?? "unknown"} on ${m.comment.path}:${m.comment.line}: ` +
        `"${excerpt(m.comment.body, 200)}" → ${m.hunkIds.join(", ")}`,
    );
  }
  for (const t of fb.threads) {
    remarks.push(
      `- [thread ${t.threadId}] Local thread (${t.commentCount} comment${t.commentCount === 1 ? "" : "s"}): ` +
        `"${t.excerpt}" → ${t.hunkIds.join(", ")}`,
    );
  }
  for (const r of fb.conversation) {
    remarks.push(
      `- [conversation ${r.id}] PR conversation remark by @${r.author ?? "unknown"}: ` + `"${excerpt(r.body, 200)}"`,
    );
  }
  lines.push(remarks.length > 0 ? remarks.join("\n") : "(no review comment, thread or conversation remark matched the delta)");
  return lines.join("\n");
}
