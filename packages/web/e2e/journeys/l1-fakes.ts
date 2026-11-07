/**
 * Union fake `gh`/`git` builders for the L1 journey (package A).
 *
 * No Playwright test calls in this module: the L1 spec and debug specs
 * import the builders from here.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { apiJson } from "./journey-helpers.js";
import type { RunningService } from "../service-harness.js";

export interface L1GhOpts {
  flipHead: string;
  stackHead: string;
  filterRepo: string;
  barRepo: string;
}

export interface L1FakePr {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision?: string;
  userRequests?: string[];
  teamRequests?: string[];
  latestReviews?: { login: string; state: string }[];
}

function l1pr(n: number, title: string, author: string, branch: string, extra: Partial<L1FakePr> = {}): L1FakePr {
  return {
    number: n,
    title,
    author,
    updatedAt: new Date().toISOString(),
    headRefName: branch,
    additions: 10 + n,
    deletions: n,
    changedFiles: 2,
    url: `https://github.com/acme/prlist/pull/${n}`,
    state: "OPEN",
    isDraft: false,
    ...extra,
  };
}

function l1node(p: L1FakePr): unknown {
  return {
    __typename: "PullRequest",
    number: p.number,
    title: p.title,
    author: { login: p.author },
    updatedAt: p.updatedAt,
    headRefName: p.headRefName,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    url: p.url,
    state: p.state,
    isDraft: p.isDraft,
    ...(p.reviewDecision !== undefined ? { reviewDecision: p.reviewDecision } : {}),
    reviewRequests: {
      nodes: [
        ...(p.userRequests ?? []).map((login) => ({ requestedReviewer: { __typename: "User", login } })),
        ...(p.teamRequests ?? []).map((slug) => ({ requestedReviewer: { __typename: "Team", slug } })),
      ],
    },
    latestReviews: { nodes: (p.latestReviews ?? []).map((r) => ({ author: { login: r.login }, state: r.state })) },
  };
}

function l1searchPage(rows: L1FakePr[], endCursor: string | null, hasNextPage: boolean): string {
  return JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage, endCursor },
        nodes: rows.map(l1node),
      },
    },
  });
}

const L1_EMPTY_SEARCH = JSON.stringify({
  data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
});

// prlist repo (j225): Your PRs open + draft; requested-of-you empty; team mix.
const PL_AUTHORING: L1FakePr[] = [
  l1pr(101, "Fix quadratic backtracking in OWS matching", "teammate", "fix-quadratic"),
  l1pr(102, "WIP: normalize folded headers on parse", "teammate", "wip-normalize", { isDraft: true }),
];
const PL_TEAM: L1FakePr[] = [
  l1pr(201, "Bump minimum Python to 3.10", "teammate", "py310", { teamRequests: ["core-team"] }),
  l1pr(202, "Drop the old compat shim", "teammate", "drop-shim", { state: "MERGED" }),
  l1pr(203, "Add OWS regression tests", "teammate", "ows-tests", { reviewDecision: "CHANGES_REQUESTED" }),
  l1pr(204, "Document header unfolding", "teammate", "docs-unfold", { reviewDecision: "APPROVED" }),
  l1pr(205, "Re-requested after changes", "teammate", "re-requested", {
    reviewDecision: "CHANGES_REQUESTED",
    userRequests: ["reviewer"],
    latestReviews: [{ login: "reviewer", state: "CHANGES_REQUESTED" }],
  }),
];

// filter repo (j228): Your PRs ignore the filter; requested groups carry authors.
const FI_AUTHORING: L1FakePr[] = [
  l1pr(101, "Alice adds folded-header parsing", "alice", "alice-parse"),
  l1pr(102, "Bob fixes header unfolding", "bob", "bob-unfold"),
];
const FI_DIRECT: L1FakePr[] = [l1pr(103, "Bob asks for your review", "bob", "bob-ask")];
const FI_TEAM: L1FakePr[] = [
  l1pr(103, "Bob asks for your review", "bob", "bob-ask"),
  l1pr(104, "Alice asks the team", "alice", "alice-team", { teamRequests: ["core-team"] }),
];

// more repo (j297): 30-row pages, a late author, a typed-search-only login.
function l1morePr(n: number, title: string, author: string): L1FakePr {
  return l1pr(n, title, author, `ask-branch-${n}`, {
    url: `https://github.com/acme/more/pull/${n}`,
  });
}
const MO_AUTHORING: L1FakePr[] = [
  l1morePr(101, "My folded-header PR", "you"),
  l1morePr(102, "My unfolding PR", "you"),
];
const MO_DIRECT_CORE: L1FakePr[] = Array.from({ length: 35 }, (_, i) => {
  const n = 301 + i;
  const author = i < 30 ? (i % 2 === 0 ? "alice" : "bob") : "carol";
  return l1morePr(n, author === "carol" ? `Carol late ask ${n}` : `Review ask ${n}`, author);
});
const MO_YARA: L1FakePr[] = [
  { ...l1morePr(336, "Yara's direct-only ask", "yara"), updatedAt: new Date(Date.now() - 2 * 86400_000).toISOString() },
];
const MO_EXTRA: L1FakePr[] = Array.from({ length: 60 }, (_, i) => {
  const n = 336 + i;
  return l1morePr(n, `Review ask ${n}`, i % 2 === 0 ? "alice" : "bob");
});
const MO_TEAM: L1FakePr[] = [
  l1morePr(401, "Alice asks the team", "alice"),
  l1morePr(402, "Bob asks the team", "bob"),
];
const MO_DIANA: L1FakePr[] = [l1morePr(501, "Diana's special ask", "diana")];
const MO_DIRECT_FULL: L1FakePr[] = [...MO_YARA, ...MO_DIRECT_CORE, ...MO_EXTRA];
const MO_DIRECT_PAGES: L1FakePr[][] = [
  MO_DIRECT_FULL.slice(0, 30),
  MO_DIRECT_FULL.slice(30, 60),
  MO_DIRECT_FULL.slice(60, 90),
  MO_DIRECT_FULL.slice(90),
];
const MO_TEAM_FULL: L1FakePr[] = [...MO_DIRECT_CORE, ...MO_EXTRA, ...MO_TEAM];
const MO_TEAM_PAGES: L1FakePr[][] = [
  MO_TEAM_FULL.slice(0, 30),
  MO_TEAM_FULL.slice(30, 60),
  MO_TEAM_FULL.slice(60, 90),
  MO_TEAM_FULL.slice(90),
];
const MO_DIRECT_BY_LOGIN: Record<string, L1FakePr[]> = {
  alice: MO_DIRECT_FULL.filter((p) => p.author === "alice"),
  bob: MO_DIRECT_FULL.filter((p) => p.author === "bob"),
  carol: MO_DIRECT_FULL.filter((p) => p.author === "carol"),
  diana: MO_DIANA,
  yara: MO_YARA,
};

// stack repo (j321): 3-PR implicit stack.
const ST_STACK = [
  { number: 11, title: "Stack base change", head: "feat-a", base: "main" },
  { number: 12, title: "Stack middle change", head: "feat-b", base: "feat-a" },
  { number: 13, title: "Stack top change", head: "feat-c", base: "feat-b" },
];

export function writeL1Pools(poolDir: string): void {
  const write = (name: string, rows: L1FakePr[], cursor: string | null = null, more = false): void => {
    writeFileSync(path.join(poolDir, `${name}.json`), l1searchPage(rows, cursor, more));
  };
  write("pl-authoring", PL_AUTHORING);
  write("pl-direct", []);
  write("pl-team", PL_TEAM);
  write("fi-authoring", FI_AUTHORING);
  write("fi-direct", FI_DIRECT);
  write("fi-team", FI_TEAM);
  write("mo-authoring", MO_AUTHORING);
  MO_DIRECT_PAGES.forEach((page, i) =>
    write(`mo-direct-p${i + 1}`, page, `d${i + 1}`, i < 3),
  );
  // The direct search fails on its fourth page (the Load more error path).
  writeFileSync(
    path.join(poolDir, "mo-direct-p3.json"),
    l1searchPage(MO_DIRECT_PAGES[2]!, "d3", true),
  );
  MO_TEAM_PAGES.forEach((page, i) => write(`mo-team-p${i + 1}`, page, `t${i + 1}`, i < 3));
  writeFileSync(path.join(poolDir, "mo-team-p4.json"), l1searchPage(MO_TEAM_PAGES[3]!, null, false));
  for (const [login, rows] of Object.entries(MO_DIRECT_BY_LOGIN)) {
    write(`mo-direct-${login}`, rows);
    write(`mo-team-${login}`, [...rows, ...MO_TEAM.filter((p) => p.author === login)]);
  }
  write(
    "st-search",
    ST_STACK.map((p) =>
      l1pr(p.number, p.title, "you", p.head, { url: `https://github.com/acme/stack/pull/${p.number}` }),
    ),
  );
  writeFileSync(
    path.join(poolDir, "st-nodes.json"),
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: ST_STACK.map((p) => ({
              number: p.number,
              title: p.title,
              headRefName: p.head,
              baseRefName: p.base,
              isCrossRepository: false,
              stack: null,
              stackEntry: null,
            })),
          },
        },
      },
    }),
  );
}

/** Union fake `gh`: searches dispatch on `repo:owner/name`, `pr view` on the number. */
export function writeFakeGhL1(
  binDir: string,
  logDir: string,
  poolDir: string,
  opts: { flipHead: string; stackHead: string; filterRepo: string; barRepo: string },
): void {
  const script = `#!/bin/sh
LOG="${logDir}"
POOL="${poolDir}"
FILTER_REPO="${opts.filterRepo}"
BAR_REPO="${opts.barRepo}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  n="$3"
  case "$n" in
    1)
      COUNT=$(ls "$LOG"/view-flip-1-* 2>/dev/null | wc -l)
      touch "$LOG/view-flip-1-$COUNT"
      if [ "$COUNT" -ge 2 ]; then S="MERGED"; D="APPROVED"; else S="OPEN"; D="REVIEW_REQUIRED"; fi
      printf '{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"%s","isDraft":false,"reviewDecision":"%s","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${opts.flipHead}"}\\n' "$S" "$D"
      exit 0
      ;;
    2)
      ST=$(cat "$LOG/state" 2>/dev/null || echo open)
      HD=$(cat "$LOG/head" 2>/dev/null || echo unknown)
      if [ "$ST" = "merged" ]; then S="MERGED"; D="APPROVED"; else S="OPEN"; D="REVIEW_REQUIRED"; fi
      printf '{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"%s","isDraft":false,"reviewDecision":"%s","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"%s"}\\n' "$S" "$D" "$HD"
      exit 0
      ;;
    101)
      HD=$(git -C "$FILTER_REPO" rev-parse feature 2>/dev/null || echo unknown)
      printf '{"title":"Alice adds folded-header parsing","body":"First paragraph.","author":{"login":"alice"},"state":"OPEN","isDraft":false,"reviewDecision":"","baseRefName":"main","headRefName":"feature","headRefOid":"%s"}\\n' "$HD"
      exit 0
      ;;
    11|12|13)
      case "$n" in 11) T="Stack base change" ;; 12) T="Stack middle change" ;; *) T="Stack top change" ;; esac
      printf '{"title":"%s","body":"Body.","author":{"login":"you"},"state":"OPEN","isDraft":false,"reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${opts.stackHead}"}\\n' "$T"
      exit 0
      ;;
    7502)
      HD=$(git -C "$BAR_REPO" rev-parse feature 2>/dev/null || echo unknown)
      printf '{"title":"Long name PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"%s"}\\n' "$HD"
      exit 0
      ;;
  esac
  echo "fake gh: unexpected pr view: $*" >&2; exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  sleep 0.2
  case "$*" in
    # Stacks query (repository owner/name + pullRequests): no repo qualifier,
    # so it dispatches before the repo branches. Only the stack repo asks
    # for pullRequests.
    *pullRequests\\(*)
      case "$*" in
        *name=stack*) cat "$POOL/st-nodes.json" ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    # Batched status query (repository owner/name + pullRequest(number:)):
    # no repo qualifier either, so it dispatches before the repo branches.
    # Only the app repo uses it (the Refresh status check).
    *pullRequest\\(number:*)
      ST=$(cat "$LOG/state" 2>/dev/null || echo open)
      HD=$(cat "$LOG/head" 2>/dev/null || echo unknown)
      case "$*" in
        *name=app*)
          if [ "$ST" = "merged" ]; then S="MERGED"; D="APPROVED"; else S="OPEN"; D="REVIEW_REQUIRED"; fi
          printf '{"data":{"repository":{"pr2":{"number":2,"state":"%s","isDraft":false,"reviewDecision":"%s","headRefOid":"%s","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}}}}\n' "$S" "$D" "$HD"
          ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    *repo:acme/prlist*)
      case "$*" in
        *"user-review-requested:@me"*) cat "$POOL/pl-direct.json" ;; 
        *"review-requested:@me"*) cat "$POOL/pl-team.json" ;;
        *"author:"*) cat "$POOL/pl-authoring.json" ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    *repo:acme/filter*)
      case "$*" in
        *"user-review-requested:@me"*) cat "$POOL/fi-direct.json" ;;
        *"review-requested:@me"*) cat "$POOL/fi-team.json" ;;
        *"author:"*) cat "$POOL/fi-authoring.json" ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    *repo:acme/more*)
      case "$*" in
        *"author:@me"*) cat "$POOL/mo-authoring.json" ;;
        *"author:"*)
          login=$(printf '%s' "$*" | sed -n 's/.*author:\\([A-Za-z@-]*\\).*/\\1/p')
          case "$*" in
            *"user-review-requested:@me"*) f="$POOL/mo-direct-$login.json" ;;
            *) f="$POOL/mo-team-$login.json" ;;
          esac
          if [ -f "$f" ]; then cat "$f"; else echo '${L1_EMPTY_SEARCH}'; fi
          ;;
        *"user-review-requested:@me"*)
          case "$*" in
            *"after=d1"*) cat "$POOL/mo-direct-p2.json" ;;
            *"after=d2"*) cat "$POOL/mo-direct-p3.json" ;;
            *"after=d3"*) echo "fake gh: review search page 4 is down" >&2; exit 1 ;;
            *) cat "$POOL/mo-direct-p1.json" ;;
          esac
          ;;
        *"review-requested:@me"*)
          case "$*" in
            *"after=t1"*) cat "$POOL/mo-team-p2.json" ;;
            *"after=t2"*) cat "$POOL/mo-team-p3.json" ;;
            *"after=t3"*) cat "$POOL/mo-team-p4.json" ;;
            *) cat "$POOL/mo-team-p1.json" ;;
          esac
          ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    *repo:acme/app*)
      ST=$(cat "$LOG/state" 2>/dev/null || echo open)
      HD=$(cat "$LOG/head" 2>/dev/null || echo unknown)
      case "$*" in
        *search\\(query:*)
          if [ "$ST" = "merged" ]; then echo '${L1_EMPTY_SEARCH}'
          else printf '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"__typename":"PullRequest","number":2,"title":"Journey test PR","author":{"login":"author"},"updatedAt":"2026-10-01T00:00:00Z","headRefName":"feature","additions":3,"deletions":1,"changedFiles":2,"url":"https://github.com/acme/app/pull/2","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}]}}}\\n'
          fi
          ;;
        *pullRequest\\(number:*)
          if [ "$ST" = "merged" ]; then S="MERGED"; D="APPROVED"; else S="OPEN"; D="REVIEW_REQUIRED"; fi
          printf '{"data":{"repository":{"pr2":{"number":2,"state":"%s","isDraft":false,"reviewDecision":"%s","headRefOid":"%s","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}}}}\\n' "$S" "$D" "$HD"
          ;;
        *) echo "fake gh: unexpected graphql: $*" >&2; exit 1 ;;
      esac
      ;;
    *repo:acme/stack*)
      case "$*" in
        *pullRequests*) cat "$POOL/st-nodes.json" ;;
        *"author:@me"*) cat "$POOL/st-search.json" ;;
        *) echo '${L1_EMPTY_SEARCH}' ;;
      esac
      ;;
    *) echo '${L1_EMPTY_SEARCH}' ;;
  esac
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'reviewer'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as reviewer"; exit 0; fi
case "$*" in *pulls/*/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/** Fake `git`: fetches + ls-remote fail instantly offline; all else is real git. */
export function writeFakeGitL1(binDir: string, realGit: string): void {
  const script = `#!/bin/sh
case "$1" in
  fetch)
    echo "fake git: fetch stubbed offline (e2e)" >&2
    exit 1
    ;;
esac
case "$*" in
  *ls-remote*) echo "fake git: ls-remote stubbed offline (e2e)" >&2; exit 1 ;;
esac
exec "${realGit}" "$@"
`;
  writeFileSync(path.join(binDir, "git"), script, { mode: 0o755 });
}

/** Wait until a review's ingest reaches `ready`. */
export async function awaitIngestReady(svc: RunningService, id: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${id}`);
    const st = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
    if (st === "ready") return;
    if (st === "failed" || st === "empty") throw new Error(`ingest ended as ${st} for ${id}`);
    if (Date.now() > deadline) throw new Error(`ingest timed out for ${id}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

