/**
 * Mock API layer (M1 web): an in-memory implementation of the same typed
 * `ApiClient` interface as the real service client, enabled with
 * `VITE_MOCK=1` (`mise run dev:mock`).
 *
 * - Serves a `ReviewSnapshot` fixture: the real urllib3/urllib3#5020 diff
 *   from `mock/diff.ts` + the guide fixture from `mock/guide.ts` (owned by
 *   the guide agent; pages/annotations/description from the generated
 *   `fixtures/urllib3-5020/snapshot.json`).
 * - Applies mutations locally **through the same store path WS patches use**:
 *   every mutation bumps `rev` and emits `{ type: "patch", baseRev, headRev,
 *   ops }` via the zustand store's `applyEvent`, so views update exactly as
 *   they will from live WS events.
 * - `summarizeHunk` returns canned text (prototype `HSUM`) after a short
 *   delay, mimicking the async agent job.
 */
import type {
  ActionResponse,
  AddRepoRequest,
  ChangesFilter,
  Contribution,
  CreateReviewRequest,
  HunkState,
  Job,
  ModelsResponse,
  PromptExpanded,
  PromptsResponse,
  PromptTemplate,
  RefreshResponse,
  Repo,
  RepoChange,
  RepoChangesResponse,
  ReposResponse,
  Review,
  ReviewAction,
  ReviewSnapshot,
  Settings,
  UpdateHunkRequest,
  UpdateReviewResponse,
  Version,
  VersionStatus,
} from "@unvibe/shared";
import type { ApiClient } from "../api/client.js";
import { useReview } from "../state/store.js";
import { HUNK_SUMMARIES, MOCK_FILES } from "./diff.js";
import { MOCK_ANNOTATIONS, MOCK_DESCRIPTION as guideDescription, MOCK_PAGES } from "./guide.js";

export const MOCK_MODE: boolean =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_MOCK === "1";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- repos ---------------------------------------------------------------

const NOW = Date.now();

const SEED_REPOS: Repo[] = [
  { id: "urllib3", owner: "urllib3", name: "urllib3", localPath: "~/code/urllib3", lastOpened: NOW },
  {
    id: "demo-lib",
    owner: "you",
    name: "demo-lib",
    localPath: "~/code/demo-lib",
    lastOpened: 0,
    detected: true,
  },
];

const ADDED_KEY = "unvibe.mock.addedRepos";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
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
      if (f.path === "test/test_connection.py" && i === 2) {
        map.set(h.contentHash, { contentHash: h.contentHash, folded: true, reviewed: true });
      } else if (f.path === "src/urllib3/connection.py" && i === 1) {
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

/**
 * Mock description: the generated fixture's description (stable paragraph
 * ids, PR source, read-only). Owned by the guide agent in `mock/guide.ts`.
 */
const MOCK_DESCRIPTION = guideDescription;

let rev = 1;
const hunkStates = seedHunkStates();

const SETTINGS_KEY = "unvibe.mock.settings";

const DEFAULT_MOCK_SETTINGS: Settings = {
  main: { provider: "claude", model: "mock-main" },
  small: { provider: "claude", model: "mock-small" },
  secondOpinion: { provider: "codex", model: "mock-second" },
  sessionsPerProvider: 4,
  inlineBudgetTokens: 40000,
  rebuildSupersededRatio: 0.2,
  rebuildAppendedTokens: 10000,
  cacheLifetimeMs: 300000,
  idleExitMinutes: 10,
};

function getMockSettings(): Settings {
  return { ...DEFAULT_MOCK_SETTINGS, ...readJson<Partial<Settings>>(SETTINGS_KEY, {}) };
}

function seedJobs(): Job[] {
  return [
    {
      id: "job-reader-1",
      kind: "reader",
      provider: "claude",
      model: "mock-main",
      reviewId: "demo",
      priority: 10,
      state: "done",
      sessionId: "sess-reader-1",
      promptSnapshot: "You are the reader: explore the repo and write the guided review.",
      usage: { inputTokens: 48200, cachedTokens: 0, outputTokens: 6300 },
      cacheHitRate: 0,
      progress: "Finished: 6 cards",
    },
    {
      id: "job-explain-1",
      kind: "explain",
      provider: "claude",
      model: "mock-main",
      reviewId: "demo",
      priority: 100,
      state: "running",
      sessionId: "sess-reader-1",
      cardId: "central",
      promptSnapshot: "Explain the quoted text with citations to the diff.",
      usage: { inputTokens: 42500, cachedTokens: 38900, outputTokens: 1200 },
      cacheHitRate: 0.915,
      progress: "Streaming answer…",
    },
    {
      id: "job-hunk-1",
      kind: "hunk-pass",
      provider: "codex",
      model: "mock-small",
      reviewId: "demo",
      priority: 10,
      state: "queued",
      promptSnapshot: "Summarize this hunk in one line.",
    },
    {
      id: "job-critic-1",
      kind: "critic",
      provider: "claude",
      model: "mock-main",
      reviewId: "demo",
      priority: 50,
      state: "backing-off",
      attempts: 2,
      nextRetryAt: Date.now() + 45000,
      error: "429 rate limited",
      promptSnapshot: "Critique the change: findings with evidence.",
    },
  ];
}

let mockJobs: Job[] = seedJobs();

function seedContributions(): Contribution[] {
  return [
    {
      id: "ct-seed-1",
      sourceSession: "sess-reader-1",
      items: [
        {
          kind: "fact",
          text: "Folded header values are unfolded lazily on first access.",
          citations: [{ target: "diff:src-urllib3-connection.py:640-660" }],
        },
        { kind: "reader_note", text: "The reader found the regex section hard to follow.", citations: [] },
      ],
      status: "pending",
    },
    {
      id: "ct-seed-2",
      sourceSession: "t-seed",
      items: [
        {
          kind: "correction",
          text: "The central card overstates the scope: only response headers change.",
          target: "card:central#b-rule",
          citations: [],
        },
        { kind: "open_question", text: "Is the new helper covered by a socket-level test?", citations: [] },
      ],
      status: "pending",
    },
  ];
}

let mockContributions: Contribution[] = seedContributions();

/**
 * Test-only: reset hunk states and the snapshot revision to the seeded
 * fixture (component tests share this module's in-memory state).
 */
export function resetMockState(): void {
  hunkStates.clear();
  for (const [k, v] of seedHunkStates()) hunkStates.set(k, v);
  mockJobs = seedJobs();
  mockContributions = seedContributions();
  rev = 1;
}

/** Reviews that carry M5 staleness in mock mode (start page flags `r-old`). */
function isStaleReview(reviewId: string): boolean {
  return reviewId === "r-old" || reviewId === "stale-demo";
}

const STALE_RANGE_DIFF = [
  "1:  a1b2c3d ! unfold folded response headers",
  "    +++ e4f5a6b ! unfold folded response headers (amended)",
  "-:  ------- > 2:  c7d8e9f ! add socket-level test for obs-fold",
].join("\n");

function staleVersionStatus(): VersionStatus {
  const tconn = MOCK_FILES.find((f) => f.path === "test/test_connection.py");
  const changed = tconn?.hunks[2];
  const oldId = changed ? `h:${tconn.fileKey}:${changed.contentHash}` : "h:unknown:old";
  return {
    stale: true,
    fromVersion: 1,
    toVersion: 2,
    unchangedHunks: 7,
    changedHunks: 1,
    newHunks: 2,
    removedHunks: 0,
    renamedFiles: [],
    changedOldIds: [oldId],
    changedNewIds: [`${oldId}:new`],
    rangeDiff: STALE_RANGE_DIFF,
    fetchedAt: NOW,
  };
}

function staleHunkStates(): HunkState[] {
  const states = [...hunkStates.values()];
  const tconn = MOCK_FILES.find((f) => f.path === "test/test_connection.py");
  const changed = tconn?.hunks[2];
  if (!changed) return states;
  return states.map((s) =>
    s.contentHash === changed.contentHash
      ? { ...s, reviewed: false, folded: false, stale: true, needsSummary: true }
      : s,
  );
}

const MOCK_VERSION_2: Version = { ...MOCK_VERSION, n: 2, headSha: "e4f5a6b7c8d", fetchedAt: NOW };

function currentSnapshot(reviewId = "demo", version?: number): ReviewSnapshot {
  const stale = isStaleReview(reviewId);
  const viewing = version ?? (stale ? 2 : 1);
  const base: ReviewSnapshot = {
    review: {
      ...MOCK_REVIEW,
      id: reviewId,
      versions: stale ? [MOCK_VERSION, MOCK_VERSION_2] : [MOCK_VERSION],
      currentVersion: stale ? 2 : 1,
    },
    version: stale ? { ...MOCK_VERSION, n: viewing } : MOCK_VERSION,
    files: MOCK_FILES,
    description: MOCK_DESCRIPTION,
    pages: MOCK_PAGES,
    annotations: MOCK_ANNOTATIONS,
    hunkStates: stale && viewing === 2 ? staleHunkStates() : [...hunkStates.values()],
    jobs: mockJobs.filter((j) => j.reviewId === reviewId || (reviewId === "demo" && !j.reviewId)),
    contributions: reviewId === "demo" ? mockContributions : [],
    logTail: [],
    rev,
  };
  if (stale && viewing === 2) base.versionStatus = staleVersionStatus();
  return base;
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
    const authoring: RepoChange[] = [
      {
        kind: "pr",
        title: "Unfold obsolete folded response header values",
        prNumber: 5020,
        branch: "fix-obs-fold",
        author: "you",
        updatedAt: NOW - 3600000,
      },
      {
        kind: "pr",
        title: "Fix retry backoff on 429s",
        prNumber: 5011,
        branch: "fix-retry-backoff",
        author: "you",
        updatedAt: NOW - 86400000 * 2,
      },
    ];
    const requested: RepoChange[] = [
      {
        kind: "pr",
        title: "Pool: reuse connections across redirects",
        prNumber: 5018,
        branch: "pool-redirect-reuse",
        author: "teammate",
        updatedAt: NOW - 7200000,
      },
    ];
    const branches: RepoChange[] = [
      { kind: "branch", title: "fix-obs-fold", branch: "fix-obs-fold", updatedAt: NOW - 3600000 },
      { kind: "branch", title: "main", branch: "main", updatedAt: NOW - 86400000 },
      {
        kind: "branch",
        title: "experiment/lazy-headers",
        branch: "experiment/lazy-headers",
        updatedAt: NOW - 86400000 * 3,
      },
    ];
    // Previous reviews with stale state, like the service's `repoChanges`.
    const previous: RepoChange[] = [
      {
        kind: "review",
        title: "#5020 · fix-obs-fold",
        prNumber: 5020,
        branch: "fix-obs-fold",
        reviewId: "demo",
        stale: false,
      },
      {
        kind: "review",
        title: "#5011 · fix-retry-backoff",
        prNumber: 5011,
        branch: "fix-retry-backoff",
        reviewId: "r-old",
        stale: true,
      },
    ];
    void id;
    switch (filter) {
      case "authoring":
        return { changes: authoring };
      case "review-requested":
        return { changes: requested };
      case "branches":
        return { changes: branches };
      case "recent":
        return { changes: [...branches, ...previous] };
      default:
        return { changes: [...authoring, ...requested, ...branches, ...previous] };
    }
  },

  createReview: async (body: CreateReviewRequest): Promise<ReviewSnapshot> => {
    void body;
    await wait(150);
    return currentSnapshot("demo");
  },

  review: async (id: string, version?: number): Promise<ReviewSnapshot> => {
    await wait(50);
    if (isStaleReview(id) && version !== undefined && version !== 1 && version !== 2) {
      throw new Error(`GET /api/reviews/${id}?version=${version}: 404 {"error":"unknown version ${version}"}`);
    }
    return currentSnapshot(id, version);
  },

  refresh: async (id: string): Promise<RefreshResponse> => {
    await wait(100);
    if (isStaleReview(id)) {
      const status = staleVersionStatus();
      return {
        review: { ...MOCK_REVIEW, id, currentVersion: 2 },
        newVersion: true,
        comparison: {
          oldVersion: status.fromVersion,
          newVersion: status.toVersion,
          oldHeadSha: MOCK_VERSION.headSha,
          newHeadSha: "e4f5a6b7c8",
          renames: [],
          rangeDiff: status.rangeDiff,
          unchangedHunks: status.unchangedHunks,
          changedHunks: status.changedHunks,
          newHunks: status.newHunks,
          removedHunks: status.removedHunks,
          changedOldIds: status.changedOldIds,
          changedNewIds: status.changedNewIds,
        },
        version: { ...MOCK_VERSION, n: 2 },
      };
    }
    return { review: MOCK_REVIEW, newVersion: false };
  },

  update: async (id: string): Promise<UpdateReviewResponse> => {
    await wait(100);
    return { jobId: `mock-update-${id}`, toVersion: isStaleReview(id) ? 2 : 1 };
  },

  action: async (_id: string, a: ReviewAction): Promise<ActionResponse> => {
    // Guide instant state (PRD §4.3/§4.4) applies locally through the patch
    // path; everything agent-driven answers `accepted: false` until the
    // service implements it (the UI toasts).
    if (a.kind !== "read" && a.kind !== "collapse" && a.kind !== "bookmark") {
      return { accepted: false };
    }
    const snap = useReview.getState().snapshot;
    if (!snap) return { accepted: false };
    const action = a;
    const pages = snap.pages.map((p) => {
      if (action.kind === "bookmark") {
        return p.id === action.pageId ? { ...p, saved: action.saved } : p;
      }
      return {
        ...p,
        cards: p.cards.map((c) => {
          if (c.id !== action.cardId) return c;
          if (action.kind === "read") {
            return { ...c, read: action.read, collapsed: action.read ? true : c.collapsed };
          }
          return { ...c, collapsed: action.collapsed };
        }),
      };
    });
    const baseRev = rev;
    rev += 1;
    useReview.getState().applyEvent({
      type: "patch",
      baseRev,
      headRev: rev,
      ops: [{ op: "replace", path: "/pages", value: pages }],
    });
    return { accepted: true };
  },

  // Mirrors the service PATCH semantics: null clears note/summary.
  updateHunk: async (_id: string, hash: string, body: UpdateHunkRequest): Promise<{ ok: boolean }> => {
    const prev = hunkStates.get(hash) ?? { contentHash: hash, folded: false, reviewed: false };
    const next: HunkState = { ...prev };
    if (body.folded !== undefined) next.folded = body.folded;
    if (body.reviewed !== undefined) next.reviewed = body.reviewed;
    if (body.note === null) delete next.note;
    else if (body.note !== undefined) next.note = body.note;
    if (body.summary === null) delete next.summary;
    else if (body.summary !== undefined) next.summary = body.summary;
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

  settings: async (): Promise<Settings> => getMockSettings(),

  saveSettings: async (body: Partial<Settings>): Promise<Settings> => {
    const next = { ...getMockSettings(), ...body };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(body));
    } catch {
      // Non-fatal.
    }
    return next;
  },

  models: async (provider: string): Promise<ModelsResponse> => {
    const catalog: Record<string, string[]> = {
      claude: ["mock-main", "mock-small", "mock-opus"],
      codex: ["mock-second", "mock-mini"],
    };
    const models = catalog[provider];
    if (!models) {
      throw new Error(
        `GET /api/models?provider=${provider}: 404 {"error":"no models for provider \\"${provider}\\": adapter not installed or not logged in"}`,
      );
    }
    return { provider, models };
  },

  prompts: async (reviewId?: string): Promise<PromptsResponse> => {
    const templates: PromptTemplate[] = MOCK_TEMPLATES;
    if (!reviewId) return { templates };
    return { templates, expanded: MOCK_TEMPLATES.map((t) => mockExpanded(t.name)) };
  },

  jobs: async (reviewId?: string): Promise<{ jobs: Job[] }> => ({
    jobs: reviewId ? mockJobs.filter((j) => j.reviewId === reviewId) : [...mockJobs],
  }),

  job: async (id: string) => {
    const job = mockJobs.find((j) => j.id === id);
    if (!job) throw new Error(`GET /api/jobs/${id}: 404 {"error":"unknown job"}`);
    return { job };
  },

  jobPrompt: async (id: string) => {
    const job = mockJobs.find((j) => j.id === id);
    if (!job) throw new Error(`GET /api/jobs/${id}/prompt: 404 {"error":"unknown job"}`);
    if (job.promptSnapshot === undefined) {
      throw new Error(`GET /api/jobs/${id}/prompt: 404 {"error":"no prompt snapshot for job"}`);
    }
    return { jobId: job.id, promptSnapshot: job.promptSnapshot };
  },

  cancelJob: async (id: string) => {
    const job = mockJobs.find((j) => j.id === id);
    if (!job) throw new Error(`POST /api/jobs/${id}/cancel: 404 {"error":"unknown job"}`);
    const next = { ...job, state: "cancelled" as const };
    mockJobs = mockJobs.map((j) => (j.id === id ? next : j));
    return { job: next };
  },

  setJobPriority: async (id: string, priority: number) => {
    const job = mockJobs.find((j) => j.id === id);
    if (!job) throw new Error(`PATCH /api/jobs/${id}: 404 {"error":"unknown job"}`);
    const next = { ...job, priority };
    mockJobs = mockJobs.map((j) => (j.id === id ? next : j));
    return { job: next };
  },

  contributions: async (reviewId: string) => ({
    contributions: reviewId === "demo" ? [...mockContributions] : [],
  }),

  deleteContribution: async (reviewId: string, contributionId: string) => {
    void reviewId;
    if (!mockContributions.some((c) => c.id === contributionId)) {
      throw new Error(`DELETE /api/reviews/demo/contributions/${contributionId}: 404`);
    }
    mockContributions = mockContributions.filter((c) => c.id !== contributionId);
    return { ok: true as const, deletedId: contributionId };
  },
} satisfies ApiClient;

const MOCK_TEMPLATES: PromptTemplate[] = [
  {
    name: "instructions",
    role: "system",
    tier: "main",
    variables: [],
    template: "You are helping a person read and review a code change.\nLink code as [[diff:file:line]] tokens.",
  },
  {
    name: "reader",
    role: "user",
    tier: "main",
    variables: ["source", "diff_inline", "repo_path"],
    template:
      "You are the reader: explore the change.\n\n## Source under review\n\n{{source}}\n\n## Diff\n\n{{diff_inline}}\n\nThe branch is checked out at `{{repo_path}}`.",
  },
  {
    name: "base_pack",
    role: "user",
    tier: "main",
    variables: ["source", "diff_inline", "pinned_code", "guide", "concepts", "hunk_summaries"],
    template:
      "Base context pack.\n\n{{source}}\n\n{{diff_inline}}\n\n{{pinned_code}}\n\n{{guide}}\n\n{{concepts}}\n\n{{hunk_summaries}}",
  },
  {
    name: "explain",
    role: "user",
    tier: "main",
    variables: ["anchor", "card", "thread", "change_list", "message"],
    template:
      "Explain the quoted text.\n\nQuote: {{anchor.quote}}\n\nCard:\n{{card}}\n\nThread:\n{{thread}}\n\nChanges:\n{{change_list}}\n\nMessage: {{message}}",
  },
];

function mockExpanded(name: string): PromptExpanded {
  const spans: { layer: "L0" | "L1" | "L1b" | "L2" | "L3" | "L4"; label: string; text: string; cached: boolean }[] =
    name === "instructions"
      ? [{ layer: "L0", label: "instructions", text: "You are helping a person read and review a code change.", cached: false }]
      : [
          { layer: "L0", label: "instructions", text: "You are helping a person read and review a code change.", cached: true },
          { layer: "L1", label: "source", text: "PR #5020 on urllib3/urllib3\nDiff: 8 hunks, +42 −18", cached: true },
          { layer: "L1b", label: "pinned", text: "(no pinned excerpts)", cached: true },
          { layer: "L2", label: "guide", text: "### The central change [[card:central]]\n\nUnfold obsolete folded values.", cached: true },
          { layer: "L3", label: "log", text: "(log is empty)", cached: true },
          {
            layer: "L4",
            label: name,
            text: name === "explain" ? "(no text selected — open this template from Explain/Ask/Note)" : `Task for ${name}.`,
            cached: false,
          },
        ];
  const parts: string[] = [];
  let cachedTokens = 0;
  const layers = spans.map((s) => {
    const tokens = Math.max(1, Math.ceil(s.text.length / 4));
    if (s.cached) cachedTokens += tokens;
    const flag = s.cached ? "cached:yes" : "cached:no";
    parts.push(
      `<!-- layer:${s.layer} label:${s.label} tokens:${tokens} ${flag} -->\n${s.text}\n<!-- /layer:${s.layer} -->\n`,
    );
    return { layer: s.layer, tokens };
  });
  return { name, expanded: parts.join("\n"), layers, cachedTokens };
}
