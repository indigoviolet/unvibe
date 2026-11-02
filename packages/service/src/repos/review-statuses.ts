/**
 * #298: batched review-status refresh for the start page.
 *
 * Runs only when the start page loads or its Refresh is pressed (the
 * web calls `POST /api/repos/:id/review-statuses` from the same load
 * as the PR/branch lists). No polling, no background job, no
 * re-ingest and no agent work: it only updates each stored review's
 * PR state / review decision and its "new commits" tag
 * (`pendingHeadSha`), which the review's own refresh clears when it
 * builds the real new version on open.
 *
 * Batching: all PR-backed reviews of one repo are answered by ONE
 * GraphQL query (`repository { pr<N>: pullRequest(number: <N>) … }`
 * aliases), never one call per review. Branch/local reviews use the
 * local git tip only, where that is already resolvable — no fetch.
 */
import type { Repo, ReviewStatusUpdate } from "@unvibe/shared";
import { displayedReviewDecision, ingestStatusOf, isDocumentReview, prStateFromGh } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";
import type { ReviewStore } from "../state/store.js";

export interface ReviewStatusesDeps {
  runner: CommandRunner;
  db: DatabaseSync;
  reviews: ReviewStore;
}

interface ReviewRow {
  id: string;
  branch: string;
  pr_number: number | null;
}

/** Fields every aliased PR answers in the one batched query. */
const PR_FIELDS = `number state isDraft reviewDecision headRefOid
  reviewRequests(first: 30) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Team { slug name } } } }
  latestReviews(first: 30) { nodes { author { login } state } }`;

/** One GraphQL query covering every PR number (alias `pr<N>` per PR). Pure. */
export function buildPrStatusesQuery(prNumbers: number[]): string {
  const aliases = prNumbers.map((n) => `pr${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join("\n");
  return `query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
}

interface GhPrStatus {
  state?: unknown;
  isDraft?: unknown;
  reviewDecision?: unknown;
  headRefOid?: unknown;
  reviewRequests?: unknown;
  latestReviews?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Flatten a connection-shaped field (`{nodes}`) to its node list. */
function nodesOf(v: unknown): unknown[] {
  const rec = asRecord(v);
  return rec && Array.isArray(rec.nodes) ? rec.nodes : Array.isArray(v) ? v : [];
}

/** `reviewRequests` in `gh pr view` shape ({login} users) for the shared decision rule. */
function flatReviewRequests(v: unknown): unknown[] {
  return nodesOf(v).map((edge) => {
    const reviewer = asRecord(asRecord(edge)?.requestedReviewer);
    return reviewer ?? edge;
  });
}

function flatLatestReviews(v: unknown): unknown[] {
  return nodesOf(v);
}

/** Parse the batched response into PR number → raw gh status. Pure. */
export function parsePrStatuses(stdout: string, prNumbers: number[]): Map<number, GhPrStatus> {
  const out = new Map<number, GhPrStatus>();
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return out;
  }
  const repo = asRecord(asRecord(asRecord(data)?.data)?.repository);
  if (!repo) return out;
  for (const n of prNumbers) {
    const pr = asRecord(repo[`pr${n}`]);
    if (pr) out.set(n, pr as GhPrStatus);
  }
  return out;
}

async function fetchPrStatuses(
  deps: ReviewStatusesDeps,
  repo: Repo,
  prNumbers: number[],
): Promise<Map<number, GhPrStatus>> {
  if (prNumbers.length === 0 || repo.owner === "local") return new Map();
  const args = [
    "api",
    "graphql",
    "--raw-field",
    `query=${buildPrStatusesQuery(prNumbers)}`,
    "-F",
    `owner=${repo.owner}`,
    "-F",
    `name=${repo.name}`,
  ];
  try {
    const res = await runGh(deps.runner, args, { args, cwd: repo.localPath });
    if (res.code !== 0) return new Map();
    return parsePrStatuses(res.stdout, prNumbers);
  } catch {
    return new Map();
  }
}

async function localTip(deps: ReviewStatusesDeps, repoPath: string, branch: string): Promise<string> {
  for (const ref of [branch, `origin/${branch}`]) {
    try {
      const res = await deps.runner.run("git", { args: ["rev-parse", ref], cwd: repoPath });
      if (res.code === 0 && res.stdout.trim() !== "") return res.stdout.trim();
    } catch {
      // Unresolvable tip: not stale as far as we know.
    }
  }
  return "";
}

/**
 * Refresh every review of `repo` and return their fresh statuses.
 * Stored PR state/decision and `pendingHeadSha` are mutated only
 * when something actually changed. Failures degrade per review to
 * the stored state — this never throws.
 */
export async function refreshRepoReviewStatuses(
  deps: ReviewStatusesDeps,
  repo: Repo,
): Promise<ReviewStatusUpdate[]> {
  let rows: ReviewRow[] = [];
  try {
    rows = deps.db
      .prepare("SELECT id, branch, pr_number FROM reviews WHERE repo_id = ? ORDER BY created_at DESC")
      .all(repo.id) as unknown as ReviewRow[];
  } catch {
    return [];
  }
  if (rows.length === 0) return [];

  const prNumbers = [...new Set(rows.map((r) => r.pr_number).filter((n): n is number => n !== null))];
  const ghStatuses = await fetchPrStatuses(deps, repo, prNumbers);

  const out: ReviewStatusUpdate[] = [];
  for (const row of rows) {
    try {
      const snap = deps.reviews.getSnapshot(row.id);
      if (!snap || isDocumentReview(snap) || ingestStatusOf(snap) !== "ready") continue;
      const currentHead = snap.version.headSha;
      let headSha = "";
      let prState: ReviewStatusUpdate["prState"];
      let reviewDecision: ReviewStatusUpdate["reviewDecision"];
      if (row.pr_number !== null) {
        const gh = ghStatuses.get(row.pr_number);
        if (!gh) {
          // Not answered (deleted PR, gh down): keep the stored state.
          out.push({
            reviewId: row.id,
            prNumber: row.pr_number,
            ...(snap.description?.state !== undefined
              ? { prState: prStateFromGh(snap.description.state, snap.description.isDraft) }
              : {}),
            ...(snap.description?.reviewDecision !== undefined ? { reviewDecision: snap.description.reviewDecision } : {}),
            stale: (snap.versionStatus?.stale ?? false) || (snap.pendingHeadSha !== undefined && snap.pendingHeadSha !== currentHead),
          });
          continue;
        }
        prState = prStateFromGh(gh.state, gh.isDraft);
        reviewDecision = displayedReviewDecision({
          reviewDecision: gh.reviewDecision,
          reviewRequests: flatReviewRequests(gh.reviewRequests),
          latestReviews: flatLatestReviews(gh.latestReviews),
        });
        headSha = typeof gh.headRefOid === "string" ? gh.headRefOid : "";
      } else {
        headSha = await localTip(deps, repo.localPath, row.branch);
      }

      const headMoved = headSha !== "" && headSha !== currentHead;
      const stale = (snap.versionStatus?.stale ?? false) || headMoved;
      // Stored raw state for the mutate comparison (same shape #230 writes).
      let rawState: string | undefined;
      let isDraft = false;
      if (prState !== undefined) {
        rawState = prState === "merged" ? "MERGED" : prState === "closed" ? "CLOSED" : "OPEN";
        isDraft = prState === "draft";
      }
      const desc = snap.description;
      const stateChanged =
        row.pr_number !== null &&
        desc !== undefined &&
        desc.source === "pr" &&
        rawState !== undefined &&
        (desc.state !== rawState || (desc.isDraft ?? false) !== isDraft || desc.reviewDecision !== reviewDecision);
      const pendingChanged = headMoved
        ? snap.pendingHeadSha !== headSha
        : snap.pendingHeadSha !== undefined && headSha !== "";
      if (stateChanged || pendingChanged) {
        await deps.reviews.mutate(row.id, (draft) => {
          if (stateChanged && draft.description) {
            if (rawState !== undefined) {
              draft.description.state = rawState;
              draft.description.isDraft = isDraft;
            }
            if (reviewDecision !== undefined) draft.description.reviewDecision = reviewDecision;
            else delete draft.description.reviewDecision;
          }
          if (headMoved) draft.pendingHeadSha = headSha;
          else if (pendingChanged) delete draft.pendingHeadSha;
        });
      }
      out.push({
        reviewId: row.id,
        ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
        ...(prState !== undefined ? { prState } : {}),
        ...(reviewDecision !== undefined ? { reviewDecision } : {}),
        ...(headSha !== "" ? { headSha } : {}),
        stale,
      });
    } catch {
      // One review failing to sync never fails the listing.
    }
  }
  return out;
}
