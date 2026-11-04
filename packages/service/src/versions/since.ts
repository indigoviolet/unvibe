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
import { compareHunks, hunkId } from "./compare.js";

/** New-side `h:` IDs changed or added between two stored diffs. Pure. */
export function computeSinceHunks(bFiles: ReviewFile[], curFiles: ReviewFile[]): SinceHunks {
  const cmp = compareHunks(bFiles, curFiles);
  return {
    changed: cmp.changed.map((c) => c.newId),
    added: cmp.added.map((a) => a.id),
  };
}

/**
 * Baseline the next update pass explains from: the stored pick, or the
 * version last opened (the refresh's `fromVersion`) when nothing was
 * picked. Pure.
 */
export function resolveSinceBaseline(snapshot: ReviewSnapshot): SinceBaseline {
  const stored = snapshot.sinceBaseline;
  if (stored && Number.isSafeInteger(stored.version) && stored.version >= 1) {
    return { kind: "version", version: stored.version };
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
  if (snapshot.version.n === n) {
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
  baseline: number;
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
  const baseline = resolveSinceBaseline(snapshot).version;
  const headVersion = snapshot.review.currentVersion;
  const bRow = versionRow(snapshot, baseline);
  const headRow = versionRow(snapshot, headVersion);
  const windowStart = bRow?.fetchedAt ?? null;
  const windowEnd = headRow?.fetchedAt ?? null;

  const sinceIds = new Set([...since.added, ...since.changed]);
  const ranges = sinceRanges(snapshot.files, sinceIds);
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
export function formatSinceContext(snapshot: ReviewSnapshot, since: SinceHunks): string {
  const fb = matchSinceFeedback(snapshot, since);
  const bRow = versionRow(snapshot, fb.baseline);
  const headRow = versionRow(snapshot, fb.headVersion);
  const lines: string[] = [];
  lines.push("## Baseline");
  if (bRow && headRow) {
    lines.push(
      `B is ${versionLabel(fb.baseline, bRow.headSha, bRow.fetchedAt)}; ` +
        `head is ${versionLabel(fb.headVersion, headRow.headSha, headRow.fetchedAt)}. ` +
        `Explain only the ${since.changed.length} changed + ${since.added.length} new hunks since B.`,
    );
  } else {
    lines.push(
      `B is v${fb.baseline}; head is v${fb.headVersion}. ` +
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
