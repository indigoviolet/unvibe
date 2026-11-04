/**
 * Existing PR review threads, read-only (PRD 15).
 *
 * `gh api repos/{o}/{r}/pulls/{n}/comments` lists the inline comments
 * already on the PR. The UI shows these alongside local threads so the
 * reader can see what is already posted, and the agents get them as
 * untrusted context. Nothing here writes to GitHub.
 */

import type { ExistingReviewComment, PrConversationRemark } from "@unvibe/shared";
import { renderUntrustedMarkdown } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

interface GhComment {
  id: number;
  path?: string;
  line?: number;
  original_line?: number;
  side?: string;
  body?: string;
  /** Groups replies under their thread root. */
  in_reply_to_id?: number;
  user?: { login?: string };
  created_at?: string;
  html_url?: string;
}

/** Fetch existing inline comments (read-only `gh api` GET). */
export async function fetchExistingComments(
  runner: CommandRunner,
  repoPath: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<ExistingReviewComment[]> {
  const args = ["api", `repos/${owner}/${repo}/pulls/${prNumber}/comments`];
  const res = await runGh(runner, args, { args, cwd: repoPath });
  if (res.code !== 0) {
    throw new Error(`gh api comments failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    throw new Error("gh api comments returned invalid JSON");
  }
  const list = Array.isArray(json) ? (json as GhComment[]) : [];
  return list.map((c) => {
    const body = c.body ?? "";
    return {
      id: c.id,
      ...(c.path !== undefined ? { path: c.path } : {}),
      ...(c.line !== undefined || c.original_line !== undefined
        ? { line: c.line ?? c.original_line }
        : {}),
      ...(c.side !== undefined ? { side: c.side } : {}),
      body,
      // Rendered once, at fetch, with the shared untrusted-Markdown
      // renderer: raw HTML from GitHub never reaches the DOM.
      bodyHtml: renderUntrustedMarkdown(body),
      ...(typeof c.in_reply_to_id === "number" ? { replyTo: c.in_reply_to_id } : {}),
      ...(c.user?.login ? { author: c.user.login } : {}),
      ...(c.created_at ? { createdAt: c.created_at } : {}),
      ...(c.html_url ? { htmlUrl: c.html_url } : {}),
    };
  });
}

/**
 * Issue #351: PR conversation (issue comments), read-only
 * (`gh api repos/{o}/{r}/issues/{n}/comments`). Capped (count and body)
 * for the snapshot; the update pass matches them to the delta by time.
 * Best effort — callers keep the previous list on failure.
 */
export async function fetchPrConversation(
  runner: CommandRunner,
  repoPath: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrConversationRemark[]> {
  const args = ["api", `repos/${owner}/${repo}/issues/${prNumber}/comments`];
  const res = await runGh(runner, args, { args, cwd: repoPath });
  if (res.code !== 0) {
    throw new Error(`gh api conversation failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    throw new Error("gh api conversation returned invalid JSON");
  }
  const list = (Array.isArray(json) ? json : []) as {
    id?: number;
    body?: string;
    user?: { login?: string };
    created_at?: string;
    html_url?: string;
  }[];
  return list.slice(-20).map((c, i) => ({
    id: typeof c.id === "number" ? c.id : -(i + 1),
    body: (c.body ?? "").slice(0, 2000),
    ...(c.user?.login ? { author: c.user.login } : {}),
    ...(c.created_at ? { createdAt: c.created_at } : {}),
    ...(c.html_url ? { htmlUrl: c.html_url } : {}),
  }));
}

interface GhReview {
  id?: number;
  commit_id?: string;
  state?: string;
  submitted_at?: string;
  user?: { login?: string };
}

/**
 * Issue #351 step 2: the authenticated user's own latest GitHub review on
 * a PR (read-only `gh api` GETs). Reviews by other users are ignored, as
 * are entries without a `commit_id`. Returns null when there is none, the
 * PR is not on GitHub, or GitHub cannot be reached — best effort, so the
 * open flow simply shows no offer instead of an error.
 */
export async function fetchLatestUserReview(
  runner: CommandRunner,
  repoPath: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ sha: string; submittedAt?: string; author: string } | null> {
  let login = "";
  try {
    const args = ["api", "user", "--jq", ".login"];
    const user = await runGh(runner, args, { args, cwd: repoPath });
    if (user.code !== 0) return null;
    login = user.stdout.trim().replace(/^"|"$/g, "");
    if (!login) return null;
  } catch {
    return null;
  }
  let list: GhReview[];
  try {
    const args = ["api", `repos/${owner}/${repo}/pulls/${prNumber}/reviews`, "--paginate"];
    const res = await runGh(runner, args, { args, cwd: repoPath });
    if (res.code !== 0) return null;
    const json: unknown = JSON.parse(res.stdout);
    if (!Array.isArray(json)) return null;
    list = json as GhReview[];
  } catch {
    return null;
  }
  const mine = list.filter(
    (r) => r.user?.login === login && typeof r.commit_id === "string" && r.commit_id.length > 0,
  );
  if (mine.length === 0) return null;
  mine.sort((a, b) => {
    const ta = a.submitted_at ?? "";
    const tb = b.submitted_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  const latest = mine[mine.length - 1];
  if (!latest?.commit_id) return null;
  return {
    sha: latest.commit_id,
    ...(latest.submitted_at ? { submittedAt: latest.submitted_at } : {}),
    author: login,
  };
}
