/**
 * Mock API layer (M1 web): an in-memory implementation of the same typed
 * `ApiClient` interface as the real service client, enabled with
 * `VITE_MOCK=1` (`mise run dev:mock`).
 *
 * - Serves a `ReviewSnapshot` fixture: the real urllib3/urllib3#5020 diff
 *   from `mock/diff.ts` + the guide fixture from `mock/guide.ts` (owned by
 *   the guide agent; currently empty pages/annotations).
 * - Applies mutations locally **through the same store path WS patches use**:
 *   every mutation bumps `rev` and emits `{ type: "patch", baseRev, headRev,
 *   ops }` via the zustand store's `applyEvent`, so views update exactly as
 *   they will from live WS events.
 * - `summarizeHunk` returns canned text (prototype `HSUM`) after a short
 *   delay, mimicking the async agent job.
 */
import type {
  AddRepoRequest,
  ChangesFilter,
  CreateReviewRequest,
  HunkState,
  Job,
  RefreshResponse,
  Repo,
  RepoChangesResponse,
  ReposResponse,
  Review,
  ReviewSnapshot,
  Settings,
  UpdateHunkRequest,
  Version,
} from "@unvibe/shared";
import type { ApiClient } from "../api/client.js";
import { useReview } from "../state/store.js";
import { HUNK_SUMMARIES, MOCK_FILES } from "./diff.js";
import { MOCK_ANNOTATIONS, MOCK_PAGES } from "./guide.js";

export const MOCK_MODE: boolean =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_MOCK === "1";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- repos ---------------------------------------------------------------

const NOW = Date.now();

const SEED_REPOS: Repo[] = [
  { id: "urllib3", owner: "urllib3", name: "urllib3", localPath: "~/code/urllib3", lastOpened: NOW },
  { id: "demo-lib", owner: "you", name: "demo-lib", localPath: "~/code/demo-lib", lastOpened: NOW - 86400000 },
];

const OPENED_KEY = "unvibe.mock.openedReviews";
const ADDED_KEY = "unvibe.mock.addedRepos";

export interface OpenedReview {
  reviewId: string;
  title: string;
  prNumber?: number;
  branch?: string;
  stale: boolean;
  unread: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function seedOpened(): OpenedReview[] {
  return [
    {
      reviewId: "demo",
      title: "Unfold obsolete folded response header values",
      prNumber: 5020,
      branch: "fix-obs-fold",
      stale: false,
      unread: 0,
    },
    {
      reviewId: "r-old",
      title: "Fix retry backoff on 429s",
      prNumber: 5011,
      branch: "fix-retry-backoff",
      stale: true,
      unread: 2,
    },
  ];
}

export function getOpenedReviews(): OpenedReview[] {
  const list = readJson<OpenedReview[]>(OPENED_KEY, []);
  if (list.length === 0) {
    const seed = seedOpened();
    try {
      localStorage.setItem(OPENED_KEY, JSON.stringify(seed));
    } catch {
      // Storage unavailable (private mode): fall through with the seed.
    }
    return seed;
  }
  return list;
}

export function rememberOpened(review: OpenedReview): void {
  try {
    const list = getOpenedReviews().filter((r) => r.reviewId !== review.reviewId);
    localStorage.setItem(OPENED_KEY, JSON.stringify([review, ...list].slice(0, 20)));
  } catch {
    // Non-fatal: recency is a convenience.
  }
}

function getRepos(): Repo[] {
  const added = readJson<Repo[]>(ADDED_KEY, []);
  return [...added, ...SEED_REPOS];
}

// --- review snapshot -----------------------------------------------------

const MOCK_VERSION: Version = {
  n: 1,
  headSha: "bdcc1e493e",
  mergeBaseSha: "443cb01be1",
  baseRef: "main",
  fetchedAt: NOW,
  idMapping: {},
};

const MOCK_REVIEW: Review = {
  id: "demo",
  repoId: "urllib3",
  branch: "fix-obs-fold",
  prNumber: 5020,
  versions: [MOCK_VERSION],
  currentVersion: 1,
  createdAt: NOW - 3600000,
};

function seedHunkStates(): Map<string, HunkState> {
  const map = new Map<string, HunkState>();
  for (const f of MOCK_FILES) {
    f.hunks.forEach((h, i) => {
      // Mirror the prototype's mid-use seed: one reviewed+folded hunk, one note.
      if (f.fileKey === "tconn" && i === 2) {
        map.set(h.contentHash, { contentHash: h.contentHash, folded: true, reviewed: true });
      } else if (f.fileKey === "conn" && i === 1) {
        map.set(h.contentHash, {
          contentHash: h.contentHash,
          folded: false,
          reviewed: false,
          note: "Only call site; everything else is the helper.",
        });
      }
    });
  }
  return map;
}

let rev = 1;
const hunkStates = seedHunkStates();

/**
 * Test-only: reset hunk states and the snapshot revision to the seeded
 * fixture (component tests share this module's in-memory state).
 */
export function resetMockState(): void {
  hunkStates.clear();
  for (const [k, v] of seedHunkStates()) hunkStates.set(k, v);
  rev = 1;
}

function currentSnapshot(reviewId = "demo"): ReviewSnapshot {
  return {
    review: { ...MOCK_REVIEW, id: reviewId },
    version: MOCK_VERSION,
    files: MOCK_FILES,
    pages: MOCK_PAGES,
    annotations: MOCK_ANNOTATIONS,
    hunkStates: [...hunkStates.values()],
    jobs: [] as Job[],
    contributions: [],
    logTail: [],
    rev,
  };
}

/** Emit a state patch through the same path WS patches use. */
function emitHunkStates(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/hunkStates", value: [...hunkStates.values()] }],
  });
}

function findHunkKey(hash: string): string | null {
  for (const f of MOCK_FILES) {
    const idx = f.hunks.findIndex((h) => h.contentHash === hash);
    if (idx >= 0) return `${f.fileKey}:${idx}`;
  }
  return null;
}

// --- mock client ---------------------------------------------------------

export const mockApi = {
  health: async () => ({ ok: true, version: "mock" }),

  repos: async (): Promise<ReposResponse> => ({ repos: getRepos() }),

  addRepo: async (body: AddRepoRequest): Promise<ReposResponse> => {
    const name = body.path.split("/").filter(Boolean).pop() ?? body.path;
    const repo: Repo = {
      id: `local-${name}`,
      owner: "local",
      name,
      localPath: body.path,
      lastOpened: Date.now(),
    };
    try {
      const added = readJson<Repo[]>(ADDED_KEY, []);
      localStorage.setItem(ADDED_KEY, JSON.stringify([repo, ...added]));
    } catch {
      // Non-fatal.
    }
    return { repos: getRepos() };
  },

  repoChanges: async (id: string, filter?: ChangesFilter): Promise<RepoChangesResponse> => {
    const all = {
      authoring: [
        {
          kind: "pr" as const,
          title: "Unfold obsolete folded response header values",
          prNumber: 5020,
          branch: "fix-obs-fold",
          author: "you",
          updatedAt: NOW - 3600000,
        },
        {
          kind: "pr" as const,
          title: "Fix retry backoff on 429s",
          prNumber: 5011,
          branch: "fix-retry-backoff",
          author: "you",
          updatedAt: NOW - 86400000 * 2,
        },
      ],
      requested: [
        {
          kind: "pr" as const,
          title: "Pool: reuse connections across redirects",
          prNumber: 5018,
          branch: "pool-redirect-reuse",
          author: "teammate",
          updatedAt: NOW - 7200000,
        },
      ],
      branches: [
        { kind: "branch" as const, title: "fix-obs-fold", branch: "fix-obs-fold", updatedAt: NOW - 3600000 },
        { kind: "branch" as const, title: "main", branch: "main", updatedAt: NOW - 86400000 },
        {
          kind: "branch" as const,
          title: "experiment/lazy-headers",
          branch: "experiment/lazy-headers",
          updatedAt: NOW - 86400000 * 3,
        },
      ],
    };
    void id;
    switch (filter) {
      case "authoring":
        return { changes: all.authoring };
      case "review-requested":
        return { changes: all.requested };
      case "branches":
        return { changes: all.branches };
      case "recent":
        return { changes: [...all.authoring.slice(0, 1), ...all.branches.slice(0, 2)] };
      default:
        return { changes: [...all.authoring, ...all.requested, ...all.branches] };
    }
  },

  createReview: async (body: CreateReviewRequest): Promise<ReviewSnapshot> => {
    rememberOpened({
      reviewId: "demo",
      title: body.pr === 5020 ? "Unfold obsolete folded response header values" : `Review ${body.branch ?? body.pr}`,
      prNumber: body.pr,
      branch: body.branch,
      stale: false,
      unread: 0,
    });
    await wait(150);
    return currentSnapshot("demo");
  },

  review: async (id: string): Promise<ReviewSnapshot> => {
    await wait(50);
    return currentSnapshot(id === "r-old" ? "demo" : id);
  },

  refresh: async (id: string): Promise<RefreshResponse> => {
    void id;
    await wait(100);
    return { review: MOCK_REVIEW, newVersion: false };
  },

  update: async (id: string): Promise<RefreshResponse> => {
    void id;
    await wait(100);
    return { review: MOCK_REVIEW, newVersion: false };
  },

  action: async () => ({ accepted: true, jobId: "mock-job-1" }),

  updateHunk: async (_id: string, hash: string, body: UpdateHunkRequest): Promise<{ ok: boolean }> => {
    const prev = hunkStates.get(hash) ?? { contentHash: hash, folded: false, reviewed: false };
    const next: HunkState = {
      ...prev,
      ...(body.folded !== undefined ? { folded: body.folded } : {}),
      ...(body.reviewed !== undefined ? { reviewed: body.reviewed } : {}),
      ...(body.note !== undefined ? { note: body.note || undefined } : {}),
      ...(body.summary !== undefined ? { summary: body.summary ?? undefined } : {}),
    };
    hunkStates.set(hash, next);
    emitHunkStates();
    return { ok: true };
  },

  summarizeHunk: async (_id: string, hash: string): Promise<{ jobId: string }> => {
    await wait(600);
    const key = findHunkKey(hash);
    const summary =
      (key && HUNK_SUMMARIES[key]) || "Mock summary: this hunk normalizes folded header values.";
    const prev = hunkStates.get(hash) ?? { contentHash: hash, folded: false, reviewed: false };
    hunkStates.set(hash, { ...prev, summary });
    emitHunkStates();
    return { jobId: `mock-${hash}` };
  },

  updateComment: async (): Promise<{ messages: [] }> => ({ messages: [] }),

  updateDescription: async (): Promise<{ ok: boolean }> => ({ ok: true }),

  submit: async (): Promise<{ posted: boolean; commentCount: number; descriptionUpdated: boolean }> => ({
    posted: true,
    commentCount: 0,
    descriptionUpdated: false,
  }),

  settings: async (): Promise<Settings> => ({
    main: { provider: "claude", model: "mock-main" },
    small: { provider: "claude", model: "mock-small" },
    secondOpinion: { provider: "codex", model: "mock-second" },
    sessionsPerProvider: 4,
    inlineBudgetTokens: 40000,
    rebuildSupersededRatio: 0.2,
    rebuildAppendedTokens: 10000,
  }),

  saveSettings: async (body: Settings): Promise<Settings> => body,

  prompts: async () => ({ templates: [] }),

  jobs: async () => ({ jobs: [] }),
} satisfies ApiClient;
