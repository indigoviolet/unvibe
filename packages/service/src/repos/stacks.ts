/**
 * Stacked PRs (#321): one paged GraphQL query per repo for open PRs'
 * head/base refs (+ native stack when GitHub declares one). Called only
 * on page load / Refresh via GET /api/repos/:id/stacks. No polling.
 * Native: PullRequest.stack { number size baseRefName entries } /
 * stackEntry { position } (verified by introspection, 2026-10-31).
 */
import type { PrStackInfo, Repo, StackMember, StackPrInput } from "@unvibe/shared";
import { inferStacks, nativeStacks } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

const QUERY = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title headRefName baseRefName isCrossRepository
        stack { number size baseRefName entries(first: 100) { nodes { position pullRequest { number title headRefName baseRefName } } } }
        stackEntry { position }
      }
    }
  }
}`;

type NativePr = StackPrInput & {
  stackNumber?: number; stackSize?: number; stackPosition?: number; stackBaseRefName?: string; stackMembers?: StackMember[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Parse one page. Pure (exported for tests). */
export function parseStacksPage(stdout: string): { prs: NativePr[]; hasNextPage: boolean; endCursor: string | null } {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { return { prs: [], hasNextPage: false, endCursor: null }; }
  const conn = asRecord(asRecord(asRecord(asRecord(data)?.data)?.repository)?.pullRequests);
  if (!conn) return { prs: [], hasNextPage: false, endCursor: null };
  const pageInfo = asRecord(conn.pageInfo);
  const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
  const prs: NativePr[] = [];
  for (const raw of nodes) {
    const n = asRecord(raw);
    if (!n || typeof n.number !== "number") continue;
    const base: NativePr = {
      number: n.number,
      title: typeof n.title === "string" && n.title ? n.title : `PR #${n.number}`,
      headRefName: typeof n.headRefName === "string" ? n.headRefName : "",
      baseRefName: typeof n.baseRefName === "string" ? n.baseRefName : "",
      isCrossRepository: n.isCrossRepository === true,
    };
    const stack = asRecord(n.stack);
    const entry = asRecord(n.stackEntry);
    if (stack && typeof stack.number === "number") {
      base.stackNumber = stack.number;
      if (typeof stack.size === "number") base.stackSize = stack.size;
      if (typeof stack.baseRefName === "string") base.stackBaseRefName = stack.baseRefName;
      const entryNodes = asRecord(stack.entries)?.nodes;
      if (Array.isArray(entryNodes)) {
        const members: (StackMember & { position: number })[] = [];
        for (const e of entryNodes) {
          const er = asRecord(e);
          const pr = asRecord(er?.pullRequest);
          if (!er || !pr || typeof pr.number !== "number") continue;
          members.push({
            number: pr.number,
            title: typeof pr.title === "string" && pr.title ? pr.title : `PR #${pr.number}`,
            headRefName: typeof pr.headRefName === "string" ? pr.headRefName : "",
            baseRefName: typeof pr.baseRefName === "string" ? pr.baseRefName : "",
            position: typeof er.position === "number" ? er.position : 0,
          });
        }
        members.sort((a, b) => a.position - b.position);
        base.stackMembers = members.map(({ number, title, headRefName, baseRefName }) => ({ number, title, headRefName, baseRefName }));
      }
    }
    if (entry && typeof entry.position === "number") base.stackPosition = entry.position;
    prs.push(base);
  }
  return {
    prs,
    hasNextPage: pageInfo?.hasNextPage === true,
    endCursor: typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor : null,
  };
}

/** Fetch all open PRs (paged, max 10 pages) and resolve stacks. Best effort: {} on failure. */
export async function fetchRepoStacks(runner: CommandRunner, repo: Repo): Promise<Record<number, PrStackInfo>> {
  if (repo.owner === "local") return {};
  const all: NativePr[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const args = ["api", "graphql", "--raw-field", `query=${QUERY}`, "-F", `owner=${repo.owner}`, "-F", `name=${repo.name}`, ...(after ? ["-F", `after=${after}`] : [])];
      const res = await runGh(runner, args, { args, cwd: repo.localPath });
      if (res.code !== 0) return {};
      const parsed = parseStacksPage(res.stdout);
      all.push(...parsed.prs);
      if (!parsed.hasNextPage || !parsed.endCursor) break;
      after = parsed.endCursor;
    }
  } catch { return {}; }
  const repoKey = `${repo.owner}/${repo.name}`;
  const native = nativeStacks(all, repoKey);
  const inferred = inferStacks(all, repoKey);
  // Native wins per PR; inferred fills the rest.
  const out: Record<number, PrStackInfo> = {};
  for (const [k, v] of inferred) out[k] = v;
  for (const [k, v] of native) out[k] = v;
  return out;
}
