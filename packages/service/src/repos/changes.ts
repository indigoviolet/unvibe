/**
 * Start-page changes for one repo (PRD §§4.2/15):
 *
 * - PRs you author: GraphQL search `repo:<o/n> state:open is:pr author:@me`;
 * - PRs awaiting your review: GraphQL searches
 *   `repo:<o/n> review-requested:@me` (direct + team) alongside
 *   `repo:<o/n> user-review-requested:@me` (direct only, #95);
 * - recent local and remote branches via git;
 * - reviews opened before, with stale state (head moved since fetch).
 *
 * Each search asks for exactly the fields the rows render — head branch
 * (#91), diff size (#100), the PR URL (#94), review requests (#95) and
 * latest reviews (the re-request rule, #230) — through the injectable
 * `CommandRunner`; `gh` runs with `GITHUB_TOKEN` unset. Every next page
 * is one more cursor query (#310: `after:`), never a re-fetch.
 */
import type { ChangesCursor, ChangesFilter, Repo, RepoChange } from "@unvibe/shared";
import {
  decodeChangesCursor,
  displayedReviewDecision,
  encodeChangesCursor,
  normalizeChangesAuthor,
  normalizeChangesLimit,
  prStateFromGh,
} from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

export interface ChangesDeps {
  runner: CommandRunner;
  db: DatabaseSync;
}

const BRANCH_LIMIT = 30;

/** Options for #297/#307/#310: page size, server-side author search, paging cursor. */
export interface ChangesOptions {
  /** Raw `limit` query value; normalized onto `[1, 100]` (default 30). */
  limit?: unknown;
  /**
   * Raw `author` query value. When set, the review-requested searches
   * carry `author:<login>` so a typed login fetches that author's PRs
   * from GitHub instead of filtering the loaded rows. "Your PRs"
   * (`author:@me`) never takes it.
   */
  author?: unknown;
  /** Raw `cursor` query value (an opaque token minted by a previous response). */
  cursor?: unknown;
}

/** A paged `gh` call that failed after the first page (#310). */
export class ChangesPageError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "ChangesPageError";
    this.detail = detail;
  }
}

interface GhReviewRequest {
  __typename?: string;
  login?: string;
  slug?: string;
  name?: string;
}

interface GhPr {
  number: number;
  title: string;
  author?: { login: string };
  updatedAt?: string;
  headRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  url?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  reviewRequests?: GhReviewRequest[];
  latestReviews?: unknown;
}

/**
 * Exactly the PR fields the start-page rows render, in one GraphQL
 * `search` call per list. Fields `gh` cannot return in one call are
 * simply absent (the row omits that part) — never one call per PR.
 * `reviewRequests`/`latestReviews` are connection-shaped here (`nodes`);
 * the normalizer flattens them into the shapes below.
 */
const PR_SEARCH_QUERY = `query ($q: String!, $first: Int, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        number
        title
        author { login }
        updatedAt
        headRefName
        additions
        deletions
        changedFiles
        url
        state
        isDraft
        reviewDecision
        reviewRequests(first: 30) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Bot { login }
              ... on Team { slug name }
            }
          }
        }
        latestReviews(first: 30) {
          nodes { author { login } state }
        }
      }
    }
  }
}`;

interface GhPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GhSearchResult {
  prs: GhPr[] | null;
  pageInfo: GhPageInfo | null;
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && v !== null && Array.isArray((v as { nodes?: unknown }).nodes)) {
    return (v as { nodes: unknown[] }).nodes;
  }
  return [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Flatten one search node into the row shape (null when not a PR). */
function toGhPr(node: unknown): GhPr | null {
  const n = asRecord(node);
  if (!n || n.__typename !== "PullRequest") return null;
  if (typeof n.number !== "number") return null;
  const author = asRecord(n.author);
  const login = author && typeof author.login === "string" ? author.login : undefined;
  const reviewRequests: GhReviewRequest[] = [];
  for (const edge of asList(n.reviewRequests)) {
    const reviewer = asRecord(asRecord(edge)?.requestedReviewer);
    if (!reviewer) continue;
    const row: GhReviewRequest = {};
    if (typeof reviewer.__typename === "string") row.__typename = reviewer.__typename;
    // Bots carry a login like users (gh's flat shape did the same).
    if (typeof reviewer.login === "string") row.login = reviewer.login;
    if (typeof reviewer.slug === "string") row.slug = reviewer.slug;
    if (typeof reviewer.name === "string") row.name = reviewer.name;
    if (row.login !== undefined || row.slug !== undefined || row.name !== undefined || row.__typename !== undefined) {
      reviewRequests.push(row);
    }
  }
  const latestReviews: unknown[] = [];
  for (const entry of asList(n.latestReviews)) {
    const e = asRecord(entry);
    if (!e) continue;
    const elogin = asRecord(e.author);
    const login2 = elogin && typeof elogin.login === "string" ? elogin.login : undefined;
    const state = typeof e.state === "string" ? e.state : undefined;
    if (login2 !== undefined && state !== undefined) latestReviews.push({ author: { login: login2 }, state });
  }
  return {
    number: n.number,
    title: typeof n.title === "string" && n.title !== "" ? n.title : `PR #${n.number}`,
    ...(login !== undefined ? { author: { login } } : {}),
    ...(typeof n.updatedAt === "string" ? { updatedAt: n.updatedAt } : {}),
    ...(typeof n.headRefName === "string" && n.headRefName !== "" ? { headRefName: n.headRefName } : {}),
    ...(typeof n.additions === "number" ? { additions: n.additions } : {}),
    ...(typeof n.deletions === "number" ? { deletions: n.deletions } : {}),
    ...(typeof n.changedFiles === "number" ? { changedFiles: n.changedFiles } : {}),
    ...(typeof n.url === "string" && n.url !== "" ? { url: n.url } : {}),
    ...(typeof n.state === "string" ? { state: n.state } : {}),
    ...(typeof n.isDraft === "boolean" ? { isDraft: n.isDraft } : {}),
    ...(typeof n.reviewDecision === "string" ? { reviewDecision: n.reviewDecision } : {}),
    ...(reviewRequests.length > 0 ? { reviewRequests } : {}),
    ...(latestReviews.length > 0 ? { latestReviews } : {}),
  };
}

function pageFailure(after: string | null | undefined, stderr: string): GhSearchResult {
  if (typeof after === "string") {
    // A failed next page must surface, never silently masquerade as
    // "no more rows" (the rows already shown stay put behind Retry).
    throw new ChangesPageError("couldn't load the next page from GitHub", stderr.slice(0, 220));
  }
  return { prs: null, pageInfo: null };
}

/**
 * One GraphQL `search` call; null rows on any first-page failure
 * (best-effort listing). `after` pages forward: `null` means the search
 * is exhausted (skip it), a string continues after that cursor, and an
 * absent value fetches the first page.
 */
async function searchPrs(
  runner: CommandRunner,
  repo: Repo,
  queryParts: string[],
  first: number,
  after?: string | null,
): Promise<GhSearchResult> {
  if (repo.owner === "local") return { prs: [], pageInfo: { hasNextPage: false, endCursor: null } };
  if (after === null) return { prs: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const args = [
    "api",
    "graphql",
    "--raw-field",
    `query=${PR_SEARCH_QUERY}`,
    "-F",
    `q=${[`repo:${repo.owner}/${repo.name}`, ...queryParts].join(" ")}`,
    "-F",
    `first=${first}`,
    ...(typeof after === "string" ? ["-F", `after=${after}`] : []),
  ];
  let res: { code: number; stdout: string; stderr: string };
  try {
    res = await runGh(runner, args, { args, cwd: repo.localPath });
  } catch (err) {
    return pageFailure(after, err instanceof Error ? err.message : String(err));
  }
  if (res.code !== 0) return pageFailure(after, res.stderr);
  let data: unknown;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return pageFailure(after, res.stdout.slice(0, 220));
  }
  const search = asRecord(asRecord(data)?.data)?.search;
  const s = asRecord(search);
  if (!s) return pageFailure(after, "missing data.search");
  const pageInfo = asRecord(s.pageInfo);
  const hasNextPage = pageInfo?.hasNextPage === true;
  const endCursor = typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor : null;
  const nodes = Array.isArray(s.nodes) ? s.nodes : [];
  const prs: GhPr[] = [];
  for (const node of nodes) {
    const pr = toGhPr(node);
    if (pr) prs.push(pr);
  }
  return { prs, pageInfo: { hasNextPage, endCursor } };
}

function toCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Team slugs (or names) from `gh`'s `reviewRequests` (#95). */
function requestedTeams(pr: GhPr): string[] {
  const out: string[] = [];
  for (const r of pr.reviewRequests ?? []) {
    if (typeof r !== "object" || r === null) continue;
    // User requests carry `login`; team requests carry `slug` (fall back
    // to `name` — `gh` has returned both shapes).
    if (typeof r.login === "string" && r.login !== "") continue;
    const team = [r.slug, r.name].find((s) => typeof s === "string" && s !== "");
    if (team && !out.includes(team)) out.push(team);
  }
  return out;
}

function toChange(pr: GhPr): RepoChange {
  const additions = toCount(pr.additions);
  const deletions = toCount(pr.deletions);
  const changedFiles = toCount(pr.changedFiles);
  const teams = requestedTeams(pr);
  const prState = prStateFromGh(pr.state, pr.isDraft);
  // #230: the displayed decision — re-requested changes_requested hides,
  // review_required never shows.
  const reviewDecision = displayedReviewDecision({
    reviewDecision: pr.reviewDecision,
    reviewRequests: pr.reviewRequests,
    latestReviews: pr.latestReviews,
  });
  return {
    kind: "pr" as const,
    title: pr.title || `PR #${pr.number}`,
    prNumber: pr.number,
    ...(pr.author?.login ? { author: pr.author.login } : {}),
    ...(pr.updatedAt ? { updatedAt: Date.parse(pr.updatedAt) || undefined } : {}),
    // #91: the head branch `gh search prs` could never return.
    ...(typeof pr.headRefName === "string" && pr.headRefName !== "" ? { branch: pr.headRefName } : {}),
    // #94: prefer the URL `gh` returns; the web falls back to building it.
    ...(typeof pr.url === "string" && pr.url !== "" ? { url: pr.url } : {}),
    // #100: diff size; omitted when unknown.
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    // #224: PR state + review decision badges.
    ...(prState !== undefined ? { prState } : {}),
    ...(reviewDecision !== undefined ? { reviewDecision } : {}),
    ...(teams.length > 0 ? { requestedTeams: teams } : {}),
  };
}

/** Newest first; rows without a time sort last (stable). */
function byUpdatedDesc(a: RepoChange, b: RepoChange): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

interface BranchRow {
  name: string;
  updatedAt: number;
}

/**
 * Clean one `%(refname:short)` line: strip the `* ` current marker, skip
 * detached-HEAD pseudo entries, strip the `origin/` prefix for remotes.
 */
function cleanBranchName(raw: string, remotePrefix: string | null): string | null {
  let name = raw.trimEnd();
  if (name.startsWith("* ")) name = name.slice(2).trim();
  if (name === "" || name === "HEAD" || name.startsWith("(")) return null;
  if (remotePrefix) {
    if (!name.startsWith(remotePrefix)) return null;
    name = name.slice(remotePrefix.length);
    if (name === "HEAD" || name.includes(" -> ")) return null;
  }
  return name || null;
}

/**
 * Names + committer dates via two identically-sorted calls (`git branch`
 * `--format` has no escape for a field separator, so fields cannot share
 * one call). Returns newest first, capped.
 */
async function readBranches(
  runner: CommandRunner,
  cwd: string,
  remote: boolean,
): Promise<BranchRow[]> {
  const base = remote ? ["branch", "-r"] : ["branch"];
  let names: { code: number; stdout: string };
  let dates: { code: number; stdout: string };
  try {
    [names, dates] = await Promise.all([
      runner.run("git", { args: [...base, "--sort=-committerdate", "--format=%(refname:short)"], cwd }),
      runner.run("git", { args: [...base, "--sort=-committerdate", "--format=%(committerdate:unix)"], cwd }),
    ]);
  } catch {
    return [];
  }
  if (names.code !== 0) return [];
  const nameLines = names.stdout.split("\n");
  const dateLines = dates.code === 0 ? dates.stdout.split("\n") : [];
  const rows: BranchRow[] = [];
  for (let i = 0; i < nameLines.length && rows.length < BRANCH_LIMIT; i++) {
    const name = cleanBranchName(nameLines[i], remote ? "origin/" : null);
    if (!name) continue;
    const unix = Number((dateLines[i] ?? "").trim());
    rows.push({ name, updatedAt: Number.isSafeInteger(unix) ? unix * 1000 : 0 });
  }
  return rows;
}

async function listBranches(runner: CommandRunner, repo: Repo): Promise<RepoChange[]> {
  const out: RepoChange[] = [];
  const push = (b: BranchRow): void => {
    out.push({
      kind: "branch",
      title: b.name,
      branch: b.name,
      ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
    });
  };
  try {
    for (const b of await readBranches(runner, repo.localPath, false)) push(b);
  } catch {
    // No git, no branches — reviews below still work.
  }
  try {
    for (const b of await readBranches(runner, repo.localPath, true)) {
      if (out.some((c) => c.branch === b.name)) continue;
      push(b);
    }
  } catch {
    // Remote branches are optional.
  }
  return out;
}

interface ReviewRow {
  id: string;
  branch: string;
  pr_number: number | null;
  head_sha: string | null;
}

/**
 * #149: existing reviews per source for the row markers (most recently
 * active review wins when stored duplicates meet). PR sources key by PR
 * number; branch sources key by branch with no PR number — a PR review
 * and a branch review of the same branch are different sources.
 */
interface ReviewMark {
  id: string;
  stale: boolean;
}

interface ReviewMarks {
  pr: Map<number, ReviewMark>;
  branch: Map<string, ReviewMark>;
}

function reviewMarksFor(db: DatabaseSync, repoId: string): ReviewMarks {
  const marks: ReviewMarks = { pr: new Map(), branch: new Map() };
  let rows: { id: string; pr_number: number | null; branch: string; snapshot: string | null }[];
  try {
    rows = db
      .prepare(
        `SELECT r.id AS id, r.pr_number AS pr_number, r.branch AS branch, rs.snapshot AS snapshot
         FROM reviews r LEFT JOIN review_snapshots rs ON rs.review_id = r.id
         WHERE r.repo_id = ? ORDER BY COALESCE(rs.updated_at, r.created_at) DESC`,
      )
      .all(repoId) as unknown as typeof rows;
  } catch {
    return marks;
  }
  for (const row of rows) {
    let stale = false;
    if (row.snapshot) {
      try {
        stale = (JSON.parse(row.snapshot) as { versionStatus?: { stale?: boolean } }).versionStatus?.stale ?? false;
      } catch {
        // Unreadable snapshot: not stale as far as we know.
      }
    }
    const mark: ReviewMark = { id: row.id, stale };
    if (row.pr_number !== null) {
      if (!marks.pr.has(row.pr_number)) marks.pr.set(row.pr_number, mark);
    } else {
      if (!marks.branch.has(row.branch)) marks.branch.set(row.branch, mark);
    }
  }
  return marks;
}

/** #149: mark PR/branch rows that already have a review (open, not start). */
function attachReviewMarks(changes: RepoChange[], marks: ReviewMarks): RepoChange[] {
  return changes.map((c) => {
    if (c.kind === "pr" && c.prNumber !== undefined) {
      const m = marks.pr.get(c.prNumber);
      if (m) return { ...c, reviewId: m.id, ...(m.stale ? { stale: true } : {}) };
    } else if (c.kind === "branch" && c.branch) {
      const m = marks.branch.get(c.branch);
      if (m) return { ...c, reviewId: m.id, ...(m.stale ? { stale: true } : {}) };
    }
    return c;
  });
}

/** Reviews opened before, with stale state (head moved since fetch). #92: loading reviews (no versions row yet) show too. */
async function listPreviousReviews(
  runner: CommandRunner,
  db: DatabaseSync,
  repo: Repo,
): Promise<RepoChange[]> {
  let rows: ReviewRow[];
  try {
    rows = (db
      .prepare(
        `SELECT r.id, r.branch, r.pr_number, v.head_sha
         FROM reviews r LEFT JOIN versions v
           ON v.review_id = r.id AND v.n = r.current_version
         WHERE r.repo_id = ? ORDER BY r.created_at DESC`,
      )
      .all(repo.id) as unknown) as ReviewRow[];
  } catch {
    return [];
  }
  const out: RepoChange[] = [];
  for (const row of rows) {
    let stale = false;
    if (row.head_sha) {
      try {
        const tip = await runner.run("git", { args: ["rev-parse", row.branch], cwd: repo.localPath });
        if (tip.code === 0 && tip.stdout.trim() && tip.stdout.trim() !== row.head_sha) {
          stale = true;
        }
      } catch {
        // Unresolvable tip: not stale as far as we know.
      }
    }
    // #92: loading PRs carry a `pr-<n>` branch placeholder until the ingest
    // confirms the head branch — show just `#N` until then.
    const title =
      row.pr_number !== null
        ? row.branch && !row.branch.startsWith("pr-")
          ? `#${row.pr_number} · ${row.branch}`
          : `#${row.pr_number}`
        : row.branch;
    out.push({
      kind: "review",
      title,
      ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
      branch: row.branch,
      reviewId: row.id,
      stale,
    });
  }
  return out;
}

/**
 * PRs awaiting review (#95): direct requests (`user-review-requested:@me`)
 * plus team requests (`review-requested:@me` minus the direct ones — a PR
 * asking both shows once, as direct). One GraphQL `search` call per list,
 * never per PR. When the direct call fails the distinction is unknown and
 * rows carry no scope (the web shows them as direct, as before). #297:
 * with `author` set, both searches carry `author:<login>` so a typed
 * login fetches that author's PRs from GitHub. #307: the union of both
 * searches (deduplicated by PR number). #310: each search pages with its
 * own `after:` cursor; only the next page is ever fetched.
 */
async function requestedPrs(
  runner: CommandRunner,
  repo: Repo,
  limit: number,
  author: string | null,
  cursors: { direct?: string | null; team?: string | null } = {},
): Promise<{ changes: RepoChange[]; truncated: boolean; endCursors: { direct: string | null; team: string | null } }> {
  const authorArgs = author !== null ? [`author:${author}`] : [];
  const [direct, all] = await Promise.all([
    searchPrs(runner, repo, ["user-review-requested:@me", "is:open", ...authorArgs], limit, cursors.direct),
    searchPrs(runner, repo, ["review-requested:@me", "is:open", ...authorArgs], limit, cursors.team),
  ]);
  const truncated = (direct.pageInfo?.hasNextPage ?? false) || (all.pageInfo?.hasNextPage ?? false);
  const endCursors = {
    direct: direct.pageInfo && direct.pageInfo.hasNextPage ? direct.pageInfo.endCursor : null,
    team: all.pageInfo && all.pageInfo.hasNextPage ? all.pageInfo.endCursor : null,
  };
  if (all.prs === null) {
    // The team-inclusive call failed: fall back to the direct rows alone
    // (also [] when that call failed) rather than an empty list.
    return {
      changes: (direct.prs ?? []).map((pr) => ({ ...toChange(pr), reviewScope: "direct" as const })).sort(byUpdatedDesc),
      truncated,
      endCursors,
    };
  }
  if (direct.prs === null) {
    // The distinction is unknown: return the rows without a scope (the
    // web shows unscoped rows as direct, as before) rather than
    // mislabelled.
    return { changes: all.prs.map(toChange).sort(byUpdatedDesc), truncated, endCursors };
  }
  const directNumbers = new Set(direct.prs.map((pr) => pr.number));
  // #307: union, not just the team-inclusive page. Rows both searches
  // returned show once (as direct); direct rows past the capped team
  // page are appended (as direct) instead of being dropped.
  const byNumber = new Map<number, GhPr>();
  for (const pr of all.prs) byNumber.set(pr.number, pr);
  for (const pr of direct.prs) {
    if (!byNumber.has(pr.number)) byNumber.set(pr.number, pr);
  }
  return {
    changes: [...byNumber.values()]
      .map((pr) => ({
        ...toChange(pr),
        reviewScope: (directNumbers.has(pr.number) ? "direct" : "team") as "direct" | "team",
      }))
      .sort(byUpdatedDesc),
    truncated,
    endCursors,
  };
}

/**
 * Changes for the start page. `filter` narrows the sections:
 * `authoring` (one GraphQL search), `review-requested` (two GraphQL
 * searches: direct + team-inclusive, #95), `branches` (git only),
 * `recent` (branches + previous reviews), `all` (default). #297:
 * `opts.limit` sizes every PR-list page and `opts.author` narrows the
 * review-requested searches to that login. #310: `opts.cursor` carries
 * the per-search cursors for the next page (opaque token, minted by the
 * previous response); `hasMore` is true when a search has a next page.
 */
export async function repoChanges(
  deps: ChangesDeps,
  repo: Repo,
  filter: ChangesFilter = "all",
  opts: ChangesOptions = {},
): Promise<{ changes: RepoChange[]; hasMore: boolean; cursor: string | null }> {
  const limit = normalizeChangesLimit(opts.limit);
  const author = normalizeChangesAuthor(opts.author);
  const cursors = decodeChangesCursor(opts.cursor);
  // #149: one DB read per listing; PR/branch rows that already have a
  // review carry its id (previous-review rows already carry their own).
  const marks = reviewMarksFor(deps.db, repo.id);
  const nextCursor = (c: ChangesCursor): string | null => {
    const has = c.authoring != null || c.direct != null || c.team != null;
    return has ? encodeChangesCursor(c) : null;
  };
  switch (filter) {
    case "authoring": {
      const listed = await searchPrs(deps.runner, repo, ["state:open", "is:pr", "author:@me"], limit, cursors.authoring);
      const page = listed.pageInfo;
      const cursor = page && page.hasNextPage ? { authoring: page.endCursor } : { authoring: null };
      return {
        changes: attachReviewMarks(
          (listed.prs ?? []).map(toChange).sort(byUpdatedDesc),
          marks,
        ),
        hasMore: page?.hasNextPage ?? false,
        cursor: nextCursor(cursor),
      };
    }
    case "review-requested": {
      const { changes, truncated, endCursors } = await requestedPrs(deps.runner, repo, limit, author, cursors);
      return {
        changes: attachReviewMarks(changes, marks),
        hasMore: truncated,
        cursor: nextCursor({ direct: endCursors.direct, team: endCursors.team }),
      };
    }
    case "branches":
      return { changes: attachReviewMarks(await listBranches(deps.runner, repo), marks), hasMore: false, cursor: null };
    case "recent":
      return {
        changes: [
          ...attachReviewMarks(await listBranches(deps.runner, repo), marks),
          ...(await listPreviousReviews(deps.runner, deps.db, repo)),
        ],
        // Branches are git-local and uncapped; PR lists are not fetched here.
        hasMore: false,
        cursor: null,
      };
    case "all":
    default: {
      const [authoring, requested] = await Promise.all([
        searchPrs(deps.runner, repo, ["state:open", "is:pr", "author:@me"], limit, cursors.authoring),
        requestedPrs(deps.runner, repo, limit, author, cursors),
      ]);
      const aPage = authoring.pageInfo;
      const aMore = aPage?.hasNextPage ?? false;
      const rMore = requested.truncated;
      return {
        changes: [
          ...attachReviewMarks(
            (authoring.prs ?? []).map(toChange).sort(byUpdatedDesc),
            marks,
          ),
          ...attachReviewMarks(requested.changes, marks),
          ...attachReviewMarks(await listBranches(deps.runner, repo), marks),
          ...(await listPreviousReviews(deps.runner, deps.db, repo)),
        ],
        hasMore: aMore || rMore,
        cursor: nextCursor({
          authoring: aMore ? aPage?.endCursor ?? null : null,
          direct: requested.endCursors.direct,
          team: requested.endCursors.team,
        }),
      };
    }
  }
}
