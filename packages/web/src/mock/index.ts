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
  AddRepoResponse,
  ChangesFilter,
  Contribution,
  CreateReviewRequest,
  HunkState,
  Job,
  ModelsResponse,
  PickFolderResponse,
  PromptExpanded,
  PromptsResponse,
  PromptTemplate,
  ReadinessResponse,
  RefreshResponse,
  RemoveRepoResponse,
  ResetDataResponse,
  Repo,
  RepoChange,
  RepoChangesResponse,
  ReposResponse,
  Review,
  ReviewAction,
  ReviewSnapshot,
  ReviewsListResponse,
  ReviewSummary,
  Settings,
  SwitchOutcome,
  UpdateBuildInfo,
  UpdateChannel,
  UpdateHunkRequest,
  UpdatePendingSwitch,
  UpdateReviewResponse,
  UpdateStatusResponse,
  UpdateSwitchResponse,
  Version,
  VersionStatus,
} from "@unvibe/shared";
import type { ApiClient } from "../api/client.js";
import { UpdateJobsBlockedError } from "../api/updateBlocked.js";
import { parseGitHubRepoInput } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { HUNK_SUMMARIES, MOCK_FILES } from "./diff.js";
import { MOCK_ANNOTATIONS, MOCK_DESCRIPTION as guideDescription, MOCK_PAGES } from "./guide.js";
import {
  mockAddedD2Block,
  mockDiagramSvg,
  mockSeedD2Block,
  mockUnavailableD2Block,
} from "./d2diagrams.js";

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
  // Fresh-install state for specs (`unvibe.mock.noRepos`): seeds hidden,
  // repos added during the test still listed.
  let seeds = SEED_REPOS;
  try {
    if (localStorage.getItem("unvibe.mock.noRepos")) seeds = [];
  } catch {
    // Ignore.
  }
  return [...added, ...seeds];
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
 * ids, PR source). Owned by the guide agent in `mock/guide.ts`; the
 * comments milestone presents author mode (editable) in mock so
 * description editing is exercisable without a service.
 */
const MOCK_DESCRIPTION = { ...guideDescription, editable: true, source: "pr" as const };

/** Canned Ask answers (prototype ASK, subset) for mock agent replies. */
const MOCK_ASK: { re: RegExp; a: string }[] = [
  {
    re: /\blf\b|bare|newline only/i,
    a: `Not with this PR. The fast path checks for <code>"\\r\\n"</code> and the pattern requires <code>\\r\\n</code>. <code>http.client</code> also accepts header lines that end in a bare LF, which passes through unchanged.`,
  },
  {
    re: /order|ordering|duplicate/i,
    a: `Order and duplicates are preserved. The helper works on <code>message.items()</code>, a list of pairs, then re-adds the list in its original order.`,
  },
  {
    re: /cost|slow|performance|quadratic|speed/i,
    a: `Cheap in practice. Values without CRLF skip the regex, and the message is only rewritten when something changed.`,
  },
  {
    re: /test|cover/i,
    a: `Two levels. Unit tests cover the value helper and the message helper (order, duplicates, defects, policy). A socket-level test sends a real folded response through a pool and checks both header views.`,
  },
  {
    re: /two spaces|double space|adjacent/i,
    a: `Yes. RFC 9112 allows replacing each fold with <em>one or more</em> spaces, and the helper replaces each fold with exactly one, so two adjacent folds give two spaces.`,
  },
];

function mockAnswerFor(message: string, quote: string): string {
  const found = MOCK_ASK.find((c) => c.re.test(`${message} ${quote}`));
  if (found) return found.a;
  const q = quote ? ` about <em>“${quote.replace(/</g, "&lt;")}”</em>` : "";
  return `Mock answer${q}: the live agent would answer this from the repo and the PR. In mock mode this is a canned reply so threads can be exercised end to end.`;
}

/** Canned explanation blocks (fixture-shaped: depth variants + citations). */
function mockExplainBlocks(quote: string): import("@unvibe/shared").Block[] {
  const q = quote.replace(/</g, "&lt;").slice(0, 120) || "this text";
  return [
    {
      type: "paragraph",
      id: `b-mock-exp-${Date.now().toString(36)}`,
      text: {
        simple: `In short: <em>${q}</em> is about unfolding folded header values.`,
        standard: `Mock explanation of <em>${q}</em>: the helper replaces each fold with one space before urllib3 reads the value. [[diff:src-urllib3-connection.py:80-82]]`,
        deep: `Mock deep explanation of <em>${q}</em>: obs-fold handling sits at the recipient per RFC 9112 §5.2, before interpretation or forwarding, so every consumer sees one semantic value. [[diff:src-urllib3-connection.py:80-88]]`,
      },
      citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    },
  ] as unknown as import("@unvibe/shared").Block[];
}

function mockExampleAside(): import("@unvibe/shared").Block {
  return {
    type: "aside",
    id: `b-mock-ex-${Date.now().toString(36)}`,
    kind: "Example",
    inner: [
      { type: "code", id: `b-mock-ex-${Date.now().toString(36)}-c`, code: "# mock example\n# urllib3 now returns: 'a=1; path=/ Max-Age=900'", citations: [] },
    ],
    citations: [],
  } as unknown as import("@unvibe/shared").Block;
}

function mockDiagramAside(): import("@unvibe/shared").Block {
  return mockAddedD2Block() as unknown as import("@unvibe/shared").Block;
}

function mockPrincipleAside(): import("@unvibe/shared").Block {
  return {
    type: "aside",
    id: `b-mock-pr-${Date.now().toString(36)}`,
    kind: "Underlying principle",
    inner: [
      { type: "paragraph", id: `b-mock-pr-${Date.now().toString(36)}-p`, text: { standard: "Resolve encoding at the recipient, before interpretation." }, citations: [] },
    ],
    citations: [],
  } as unknown as import("@unvibe/shared").Block;
}

type MockCardRef =
  | { kind: "page"; pageId: string; card: import("@unvibe/shared").Card }
  | { kind: "expansion"; annotation: import("@unvibe/shared").Annotation };

function findMockCard(cardId: string): MockCardRef | null {
  for (const p of mockPages) {
    const card = p.cards.find((c) => c.id === cardId);
    if (card) return { kind: "page", pageId: p.id, card };
  }
  const annotation = annotations.find((a) => a.id === cardId);
  if (annotation?.type === "expansion" && annotation.expansion) {
    return { kind: "expansion", annotation };
  }
  return null;
}

function mockCardBlocks(ref: MockCardRef): import("@unvibe/shared").Block[] {
  return (ref.kind === "page" ? ref.card.blocks : ref.annotation.expansion!.blocks) as import("@unvibe/shared").Block[];
}

function mockCardLevel(ref: MockCardRef): import("@unvibe/shared").DepthLevel {
  return (ref.kind === "page" ? ref.card.level : ref.annotation.expansion!.level) as import("@unvibe/shared").DepthLevel;
}

/** Card controls in mock: depth/examples/diagram/undo through the patch path. */
function mockCardControl(a: { kind: string; cardId: string; direction?: string }): { accepted: boolean; cardId: string; jobId?: string } {
  const ref = findMockCard(a.cardId);
  if (!ref) throw new Error(`unknown card ${a.cardId}`);
  const ORDER = ["simple", "standard", "deep"];
  if (a.kind === "depth" && (a.direction === "simpler" || a.direction === "deeper")) {
    const level = mockCardLevel(ref);
    const i = ORDER.indexOf(level);
    const next = a.direction === "simpler" ? ORDER[i - 1] : ORDER[i + 1];
    const blocks = mockCardBlocks(ref);
    if (!next) {
      // + at the deepest level adds the Underlying principle block once.
      if (a.direction === "deeper" && !blocks.some((b) => b.type === "aside" && (b as { kind: string }).kind === "Underlying principle")) {
        const cur = [...blocks];
        if (ref.kind === "page") {
          ref.card.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level });
          ref.card.blocks = [...cur, mockPrincipleAside()] as never;
          ref.card.revision += 1;
        } else {
          ref.annotation.expansion!.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level });
          ref.annotation.expansion!.blocks = [...cur, mockPrincipleAside()] as never;
          ref.annotation.expansion!.revision += 1;
        }
        emitPages();
        emitAnnotations();
        return { accepted: true, cardId: a.cardId };
      }
      return { accepted: true, cardId: a.cardId };
    }
    const from = level;
    const cur = [...blocks];
    if (ref.kind === "page") {
      ref.card.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level: from as never });
      ref.card.level = next as never;
      ref.card.revision += 1;
    } else {
      ref.annotation.expansion!.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level: from as never });
      ref.annotation.expansion!.level = next as never;
      ref.annotation.expansion!.revision += 1;
    }
    emitPages();
    emitAnnotations();
    return { accepted: true, cardId: a.cardId };
  }
  if (a.kind === "examples" || a.kind === "diagram") {
    const blocks = mockCardBlocks(ref);
    const level = mockCardLevel(ref);
    const want = a.kind === "examples" ? "Example" : null;
    if (want && blocks.some((b) => b.type === "aside" && (b as { kind: string }).kind === want)) {
      return { accepted: true, cardId: a.cardId };
    }
    if (a.kind === "diagram" && blocks.some((b) => b.type === "diagram")) {
      return { accepted: true, cardId: a.cardId };
    }
    const cur = [...blocks];
    const insert = a.kind === "examples" ? mockExampleAside() : mockDiagramAside();
    // Blocks appear after the paragraphs they relate to: insert after the
    // first paragraph when one exists, else append.
    const at = cur.findIndex((b) => b.type === "paragraph");
    const nextBlocks = at >= 0 ? [...cur.slice(0, at + 1), insert, ...cur.slice(at + 1)] : [...cur, insert];
    if (ref.kind === "page") {
      ref.card.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level: level as never });
      ref.card.blocks = nextBlocks as never;
      ref.card.revision += 1;
    } else {
      ref.annotation.expansion!.undoStack.push({ blocks: JSON.parse(JSON.stringify(cur)), level: level as never });
      ref.annotation.expansion!.blocks = nextBlocks as never;
      ref.annotation.expansion!.revision += 1;
    }
    emitPages();
    emitAnnotations();
    return { accepted: true, cardId: a.cardId };
  }
  if (a.kind === "undo") {
    if (ref.kind === "page") {
      const prev = ref.card.undoStack.pop();
      if (!prev) return { accepted: true, cardId: a.cardId };
      ref.card.blocks = prev.blocks as never;
      ref.card.level = prev.level as never;
      ref.card.revision += 1;
    } else {
      const prev = ref.annotation.expansion!.undoStack.pop();
      if (!prev) return { accepted: true, cardId: a.cardId };
      ref.annotation.expansion!.blocks = prev.blocks as never;
      ref.annotation.expansion!.level = prev.level as never;
      ref.annotation.expansion!.revision += 1;
    }
    emitPages();
    emitAnnotations();
    return { accepted: true, cardId: a.cardId };
  }
  throw new Error(`unknown mock card control ${(a as { kind: string }).kind}`);
}

function readChangesFailures(): string[] {
  try {
    const raw = localStorage.getItem("unvibe.mock.repoChangesFail");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Resolve once the `unvibe.mock.repoChangesHold` key is gone (or soon anyway). */
async function awaitChangesRelease(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    try {
      if (!localStorage.getItem("unvibe.mock.repoChangesHold")) return;
    } catch {
      return;
    }
    await wait(50);
  }
}

/** Resolve once the `unvibe.mock.addRepoHold` key is gone (or soon anyway). */
async function awaitAddRelease(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    try {
      if (!localStorage.getItem("unvibe.mock.addRepoHold")) return;
    } catch {
      return;
    }
    await wait(50);
  }
}

/** Extra clone latency in mock mode (`unvibe.mock.addRepoDelayMs`, default 150). */
function addRepoDelayMs(): number {
  try {
    const raw = localStorage.getItem("unvibe.mock.addRepoDelayMs");
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    // Fall through to the default.
  }
  return 150;
}

/** Forced add failure in mock mode (`unvibe.mock.addRepoFail` = error text). */
function addRepoFailure(): string | null {
  try {
    const raw = localStorage.getItem("unvibe.mock.addRepoFail");
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** Stale-clone note in mock mode (`unvibe.mock.repoChangesFetchError` = note). */
function changesFetchError(): string | null {
  try {
    const raw = localStorage.getItem("unvibe.mock.repoChangesFetchError");
    return raw ? raw : null;
  } catch {
    return null;
  }
}

let rev = 1;
const hunkStates = seedHunkStates();
let annotations: import("@unvibe/shared").Annotation[] = JSON.parse(
  JSON.stringify(MOCK_ANNOTATIONS),
) as import("@unvibe/shared").Annotation[];
let mockPages: import("@unvibe/shared").Page[] = JSON.parse(
  JSON.stringify(MOCK_PAGES),
) as import("@unvibe/shared").Page[];

/**
 * Seed mock D2 edge cases into the go-deeper flow card: the fixture's own
 * diagram block (rendered fixture SVGs served by `diagramSvg` below)
 * covers the ok path; the seeds add an unverified-anchor block and an
 * unavailable block (no binary), so mock-mode tests exercise those
 * branches without touching the fixture.
 */
function seedMockD2Diagrams(pages: import("@unvibe/shared").Page[]): void {
  const card = pages
    .find((p) => p.id === "root")
    ?.cards.find((c) => c.id === "g-flow");
  if (!card || card.blocks.some((b) => b.id === "b-mock-d2-edge")) return;
  card.blocks = [
    ...card.blocks,
    mockSeedD2Block() as never,
    mockUnavailableD2Block() as never,
  ];
}
seedMockD2Diagrams(mockPages);
let description = { ...MOCK_DESCRIPTION };
let existingComments: import("@unvibe/shared").ExistingReviewComment[] = [
  {
    id: 101,
    path: "src/urllib3/connection.py",
    line: 82,
    side: "RIGHT",
    body: "Already on GitHub: consider covering bare LF here too.",
    author: "teammate",
    createdAt: "2026-09-01T12:00:00Z",
    htmlUrl: "https://github.com/urllib3/urllib3/pull/5020#discussion_r101",
  },
];

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
  versionPickerEnabled: false,
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
      // Explain fills are annotation-scoped on the service (threadId, never
      // cardId): keep the seed faithful so no card shows a stuck busy state.
      threadId: "ann_seed_thread",
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
 * Mock shared-context debug document (issue #32): canned base + log plus
 * the live seed contributions, so the debug page shows all three parts and
 * delete visibly removes an item in mock mode.
 */
function mockSharedContext(reviewId: string): {
  reviewId: string;
  base: string;
  log: string;
  contributions: string;
} {
  const base = [
    "## Base",
    "",
    "1 base built for this review. The pack below is the current pack — what would be sent now, not a historical rebuild.",
    "",
    "### Base `v1|guide-mock|mock|mock-main`",
    "",
    "- version: `v1` · guide revision: `guide-mock` · provider/model: `mock/mock-main`",
    "- base tokens: 12000",
    "- appended since build: 0",
    "- superseded: 0.0%",
    "- last rebuild: built fresh",
    "",
    "### Current pack for `v1|guide-mock|mock|mock-main` (12000 tokens)",
    "",
    "#### L0 system",
    "",
    "```text",
    "You are helping a person read and review a code change.",
    "```",
    "",
    "#### L1 + L1b + L2",
    "",
    "```text",
    "PR #5020 on urllib3/urllib3",
    "Diff: 8 hunks, +42 −18",
    "### The central change [[card:central]]",
    "",
    "Unfold obsolete folded values.",
    "```",
    "",
  ].join("\n");
  const log = [
    "## Log",
    "",
    "2 entries. Entries up to seq 1 are already in base `v1|guide-mock|mock|mock-main`. Batch threshold 2000 tokens.",
    "",
    "### In base (1)",
    "",
    "```text",
    "- [1 new-card global] central card written",
    "```",
    "",
    "### Waiting for batch (1)",
    "",
    "```text",
    "- [2 thread-summary global] ask about retry settled",
    "```",
    "",
  ].join("\n");
  const parts = ["## Contributions", ""];
  if (reviewId === "demo" && mockContributions.length > 0) {
    parts.push(`${mockContributions.length} contributions.`, "");
    for (const c of mockContributions) {
      parts.push(`### ${c.id}`, "");
      parts.push(c.sourceThread ? `- thread: \`${c.sourceThread}\`` : `- session: \`${c.sourceSession}\``);
      if (c.replaces) parts.push(`- replaces: \`${c.replaces}\``);
      if (c.status === "merged" || c.items.some((i) => i.kind === "correction")) parts.push(`- status: ${c.status}`);
      for (const item of c.items) {
        const target = item.target ? ` → \`${item.target}\`` : "";
        parts.push(`- **${item.kind}**${target}: ${item.text}`);
        if (item.citations.length > 0) {
          parts.push(`  - cites: ${item.citations.map((cit) => `\`${cit.target}\``).join(", ")}`);
        }
      }
      parts.push("");
    }
  } else {
    parts.push("(no contributions yet)", "");
  }
  return { reviewId, base, log, contributions: parts.join("\n") };
}

/**
 * Test-only: reset hunk states and the snapshot revision to the seeded
 * fixture (component tests share this module's in-memory state).
 */
export function resetMockState(): void {
  mockReviewList = seedReviewList();
  try {
    localStorage.removeItem(READINESS_KEY);
  } catch {
    // Ignore.
  }
  hunkStates.clear();
  for (const [k, v] of seedHunkStates()) hunkStates.set(k, v);
  annotations = JSON.parse(JSON.stringify(MOCK_ANNOTATIONS));
  mockPages = JSON.parse(JSON.stringify(MOCK_PAGES));
  seedMockD2Diagrams(mockPages);
  description = { ...MOCK_DESCRIPTION };
  existingComments = [
    {
      id: 101,
      path: "src/urllib3/connection.py",
      line: 82,
      side: "RIGHT",
      body: "Already on GitHub: consider covering bare LF here too.",
      author: "teammate",
      createdAt: "2026-09-01T12:00:00Z",
      htmlUrl: "https://github.com/urllib3/urllib3/pull/5020#discussion_r101",
    },
  ];
  mockJobs = seedJobs();
  mockContributions = seedContributions();
  mockUpdatePending = null;
  mockUpdateDown = false;
  try {
    localStorage.removeItem(UPDATE_KEY);
  } catch {
    // Ignore.
  }
  rev = 1;
}

function seedReviewList(): ReviewSummary[] {
  const total = MOCK_FILES.reduce((n, f) => n + f.hunks.length, 0);
  const reviewed = [...seedHunkStates().values()].filter((s) => s.reviewed).length;
  return [
    {
      id: "demo",
      repoId: "urllib3",
      repoOwner: "urllib3",
      repoName: "urllib3",
      title: "Unfold obsolete folded response header values",
      branch: "fix-obs-fold",
      prNumber: 5020,
      createdAt: NOW - 3600000,
      lastOpened: NOW - 600000,
      versionCount: 1,
      currentVersion: 1,
      stale: false,
      totalHunks: total,
      reviewedHunks: reviewed,
      pendingComments: 1,
      guideStatus: "ready",
    },
    {
      id: "r-old",
      repoId: "urllib3",
      repoOwner: "urllib3",
      repoName: "urllib3",
      title: "Fix retry backoff on 429s",
      branch: "fix-retry-backoff",
      prNumber: 5011,
      createdAt: NOW - 86400000 * 2,
      lastOpened: NOW - 86400000,
      versionCount: 2,
      currentVersion: 2,
      stale: true,
      totalHunks: total,
      reviewedHunks: 0,
      pendingComments: 0,
      guideStatus: "running",
      guideDetail: "Running: critic",
    },
    ...readExtraSessions(),
  ];
}

/**
 * Test-only extra sessions for the start page (`unvibe.mock.extraSessions`,
 * a JSON array of `ReviewSummary`): e.g. a review whose repo is no longer
 * in the repo list, which the page renders in its orphan group. Read at
 * seed time so `addInitScript` can set it before the page loads.
 */
function readExtraSessions(): ReviewSummary[] {
  try {
    const raw = localStorage.getItem("unvibe.mock.extraSessions");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ReviewSummary[]) : [];
  } catch {
    return [];
  }
}

let mockReviewList: ReviewSummary[] = seedReviewList();

function mockSummaries(): ReviewSummary[] {
  return [...mockReviewList].sort((a, b) => b.lastOpened - a.lastOpened);
}

const READINESS_KEY = "unvibe.mock.readiness";

function readMockReadiness(): ReadinessResponse {
  try {
    const raw = localStorage.getItem(READINESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReadinessResponse;
      if (Array.isArray(parsed.checks)) return { ...parsed, cached: false };
    }
  } catch {
    // Fall through to healthy default.
  }
  return {
    checks: [
      { id: "git", label: "git", status: "ok", summary: "git found", fix: "", settingsAnchor: "#environment" },
      { id: "gh", label: "gh (GitHub CLI)", status: "ok", summary: "gh logged in as you", fix: "", settingsAnchor: "#environment" },
      { id: "agent:main", label: "Agent · main", status: "ok", summary: "claude/mock-main ready", fix: "", settingsAnchor: "#models" },
      { id: "agent:small", label: "Agent · small", status: "ok", summary: "claude/mock-small ready", fix: "", settingsAnchor: "#models" },
      { id: "agent:secondOpinion", label: "Agent · second opinion", status: "ok", summary: "codex/mock-second ready", fix: "", settingsAnchor: "#models" },
      { id: "agents-distinct", label: "Second opinion independence", status: "ok", summary: "Second opinion differs from main", fix: "", settingsAnchor: "#models" },
    ],
    generatedAt: Date.now(),
    cached: false,
  };
}

/** Test-only: seed a failing readiness report (e2e for callouts). */
export function setMockReadiness(next: ReadinessResponse | null): void {
  try {
    if (next) localStorage.setItem(READINESS_KEY, JSON.stringify(next));
    else localStorage.removeItem(READINESS_KEY);
  } catch {
    // Ignore.
  }
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
    description,
    pages: reviewId === "demo" ? mockPages : MOCK_PAGES,
    annotations,
    hunkStates: stale && viewing === 2 ? staleHunkStates() : [...hunkStates.values()],
    jobs: mockJobs.filter((j) => j.reviewId === reviewId || (reviewId === "demo" && !j.reviewId)),
    contributions: reviewId === "demo" ? mockContributions : [],
    logTail: [],
    rev,
    existingComments,
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

/** Emit the annotations list through the WS-patch path (drafts survive). */
function emitAnnotations(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/annotations", value: JSON.parse(JSON.stringify(annotations)) }],
  });
}

// Playwright hook (mock mode only, like DiffView's `window.__revealSource`):
// stream N no-op annotation patches through the WS-patch path so specs can
// assert highlight idempotence under many snapshot updates without moving
// focus or disturbing the selection (issue #15).
if (MOCK_MODE && typeof window !== "undefined") {
  (window as unknown as { __streamPatches?: (n: number) => void }).__streamPatches = (n: number) => {
    for (let i = 0; i < n; i++) emitAnnotations();
  };
}

/** Emit the pages list through the WS-patch path (card state converges). */
function emitPages(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/pages", value: JSON.parse(JSON.stringify(mockPages)) }],
  });
}

/** Emit the jobs list through the WS-patch path (job handover converges). */
function emitJobs(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/jobs", value: JSON.parse(JSON.stringify(mockJobs)) }],
  });
}

/**
 * Mock agent job (issue #46): like the service, every agent-starting mock
 * action reports a real snapshot job (`running` now, `done` when its fill
 * lands) so the web's in-flight → job handover runs the same path as live.
 */
function trackMockJob(
  jobId: string,
  kind: Job["kind"],
  opts?: { cardId?: string; threadId?: string; dedupeKey?: string },
): void {
  if (mockJobs.some((j) => j.id === jobId)) return;
  mockJobs.push({
    id: jobId,
    kind,
    provider: "claude",
    model: "mock-main",
    reviewId: "demo",
    priority: 100,
    state: "running",
    ...(opts?.cardId !== undefined ? { cardId: opts.cardId } : {}),
    ...(opts?.threadId !== undefined ? { threadId: opts.threadId } : {}),
    ...(opts?.dedupeKey !== undefined ? { dedupeKey: opts.dedupeKey } : {}),
  });
  emitJobs();
}

function settleMockJob(jobId: string): void {
  const job = mockJobs.find((j) => j.id === jobId);
  if (!job || job.state === "done") return;
  job.state = "done";
  emitJobs();
}

/** Emit contributions (accept/dismiss flips status without a refetch). */
function emitContributions(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/contributions", value: JSON.parse(JSON.stringify(mockContributions)) }],
  });
}

function emitDescription(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/description", value: JSON.parse(JSON.stringify(description)) }],
  });
}

function emitExisting(): void {
  const baseRev = rev;
  rev += 1;
  useReview.getState().applyEvent({
    type: "patch",
    baseRev,
    headRev: rev,
    ops: [{ op: "replace", path: "/existingComments", value: JSON.parse(JSON.stringify(existingComments)) }],
  });
}

function stripMockHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mockPostText(thread: import("@unvibe/shared").Annotation): string {
  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const you = thread.messages.find((m) => m.who === "you" && m.text);
  if (you?.text) return you.text;
  const suggested = thread.messages.find((m) => m.suggested && m.text);
  if (suggested?.text) return suggested.text;
  return thread.messages.find((m) => m.text)?.text ?? "";
}

/** Mock Submit preview: same shape as the service `buildPreview`. */
function buildMockPreview(): import("@unvibe/shared").SubmitPreview {
  const pending = annotations.filter(
    (a) => a.type === "thread" && (a as import("@unvibe/shared").Annotation).post && !(a as import("@unvibe/shared").Annotation).postedAt,
  ) as import("@unvibe/shared").Annotation[];
  const alreadyPosted = annotations
    .filter((a) => a.type === "thread" && a.post && a.postedAt)
    .map((a) => a.id);
  const comments = pending.map((thread) => {
    const host = thread.anchor.host;
    let location: import("@unvibe/shared").SubmitCommentLocation;
    if (host.kind === "diff-line") {
      const file = MOCK_FILES.find((f) => f.fileKey === host.fileKey);
      location = file
        ? { kind: "inline", path: file.path, line: host.line, side: "RIGHT" }
        : { kind: "general", reason: `unknown file ${host.fileKey}` };
    } else {
      location = { kind: "general", reason: host.kind === "block" ? "guide comment" : "description comment" };
    }
    return { threadId: thread.id, location, text: mockPostText(thread) };
  });
  const general = comments.filter((c) => c.location.kind !== "inline").map((c) => c.text);
  return {
    comments,
    alreadyPosted,
    reviewBody: general.filter((t) => t.trim() !== "").join("\n\n---\n\n"),
    commitId: MOCK_VERSION.headSha,
    ...(description.pendingMarkdown !== undefined
      ? {
          description: {
            fromRev: description.rev,
            markdown: description.pendingMarkdown,
            html: description.pendingHtml ?? description.html,
          },
        }
      : {}),
  };
}

// --- mock client ---------------------------------------------------------

function buildMockDiagnostics(): import("@unvibe/shared").DiagnosticsResponse {
  return {
    generatedAt: Date.now(),
    path: {
      shell: "/bin/zsh",
      probedPath: "/mock/bin:/usr/bin:/bin",
      inheritedPath: "/usr/bin:/bin",
      effectivePath: "/mock/bin:/usr/bin:/bin",
      onlyInProbed: ["/mock/bin"],
      onlyInInherited: [],
    },
    tools: [
      {
        tool: "claude",
        minVersion: "2.1.293",
        candidates: [
          {
            path: "/mock/bin/claude",
            source: "login-shell PATH",
            kind: "file",
            runs: true,
            exitCode: 0,
            stdout: "2.1.296",
            stderr: "",
            version: "2.1.296",
            meetsMin: true,
          },
        ],
        chosen: "/mock/bin/claude",
        chosenReason: "first on PATH runs (version 2.1.296)",
        warnings: [],
      },
      {
        tool: "codex",
        minVersion: "0.160.1",
        candidates: [
          {
            path: "/mock/bin/codex",
            source: "login-shell PATH",
            kind: "file",
            runs: true,
            exitCode: 0,
            stdout: "0.162.1",
            stderr: "",
            version: "0.162.1",
            meetsMin: true,
          },
        ],
        chosen: "/mock/bin/codex",
        chosenReason: "first on PATH runs (version 0.162.1)",
        warnings: [],
      },
    ],
    service: {
      pid: 1234,
      startedAt: new Date().toISOString(),
      cwd: "/mock",
      dataDir: "/mock/data",
      port: 4517,
      startMode: "mock",
      nodeVersion: "v24.0.0",
      serviceVersion: "0.0.1",
    },
    warnings: [],
    models: {
      claude: [{ id: "mock-main", name: "Mock Main", description: "Mock main model for tests" }],
      codex: [{ id: "mock-second", name: "Mock Second", description: "Mock second-opinion model" }],
    },
  };
}

/**
 * Version picker (issue #36, step 2) in mock mode: the installed ref and
 * the last outcome persist in localStorage (so a post-switch page reload
 * keeps them, like the real helper's data-dir files); the pending switch
 * and the mid-switch outage are transient module state. The failure mode
 * comes from localStorage `unvibe.mock.update.fail` (`install` |
 * `health` | `fatal`), read when the switch starts.
 */
const UPDATE_KEY = "unvibe.mock.update";
const UPDATE_FAIL_KEY = "unvibe.mock.update.fail";
/** Opt-in running-jobs refusal for the switch-anyway flow (`"1"` refuses). */
const UPDATE_BLOCK_JOBS_KEY = "unvibe.mock.update.blockJobs";

// Distinct build times (issue #73): the picker sorts newest first, so the
// list order is preview/feat-x, preview/fix-y, release-rc, release.
const MOCK_UPDATE_CHANNELS: UpdateChannel[] = [
  {
    ref: "release",
    kind: "release",
    version: "0.0.1",
    commit: null,
    sourceBranch: null,
    builtAt: new Date(NOW - 3 * 86400_000).toISOString(),
    current: false,
  },
  {
    ref: "release-rc",
    kind: "release-rc",
    version: "0.0.1-rc.1",
    commit: "abc1234def5678",
    sourceBranch: null,
    builtAt: new Date(NOW - 86400_000).toISOString(),
    current: false,
  },
  {
    ref: "preview/feat-x",
    kind: "preview",
    version: "0.0.1-preview.feat-x.abc1234",
    commit: "abc1234def5678",
    sourceBranch: "feat/x",
    builtAt: new Date(NOW - 3600_000).toISOString(),
    current: false,
  },
  {
    ref: "preview/fix-y",
    kind: "preview",
    version: "0.0.1-preview.fix-y.9f8e7d6",
    commit: "9f8e7d6c5b4a3",
    sourceBranch: "fix/y",
    builtAt: new Date(NOW - 7200_000).toISOString(),
    current: false,
  },
];

function readUpdatePersisted(): { current: string; outcome: SwitchOutcome | null } {
  const fallback = { current: "release", outcome: null as SwitchOutcome | null };
  try {
    const raw = localStorage.getItem(UPDATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    if (typeof parsed.current !== "string" || !MOCK_UPDATE_CHANNELS.some((c) => c.ref === parsed.current)) {
      return fallback;
    }
    return { current: parsed.current, outcome: parsed.outcome ?? null };
  } catch {
    return fallback;
  }
}

function writeUpdatePersisted(next: { current: string; outcome: SwitchOutcome | null }): void {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
}

let mockUpdatePending: UpdatePendingSwitch | null = null;
/** True while the mock "service" is down mid-switch (health throws). */
let mockUpdateDown = false;

function mockUpdateChannels(): UpdateChannel[] {
  const { current } = readUpdatePersisted();
  return MOCK_UPDATE_CHANNELS.map((c) => ({ ...c, current: c.ref === current }));
}

function mockUpdateBuild(): UpdateBuildInfo | null {
  const { current } = readUpdatePersisted();
  const found = MOCK_UPDATE_CHANNELS.find((c) => c.ref === current);
  if (!found?.version) return null;
  return {
    version: found.version,
    sourceBranch: found.sourceBranch,
    commit: found.commit,
    builtAt: found.builtAt,
  };
}

/** #92: loading snapshot for a mock loading list entry. */
function mockLoadingSnapshot(entry: ReviewSummary): ReviewSnapshot {
  const now = Date.now();
  return {
    review: {
      id: entry.id,
      repoId: entry.repoId,
      branch: entry.branch,
      ...(entry.prNumber !== undefined ? { prNumber: entry.prNumber } : {}),
      versions: [],
      currentVersion: 0,
      createdAt: entry.createdAt,
    },
    version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "loading", step: entry.ingestStep ?? "fetching" },
  };
}

/** #92: failed snapshot for a mock failed list entry. */
function mockFailedSnapshot(entry: ReviewSummary, error: string): ReviewSnapshot {
  const now = Date.now();
  return {
    review: {
      id: entry.id,
      repoId: entry.repoId,
      branch: entry.branch,
      ...(entry.prNumber !== undefined ? { prNumber: entry.prNumber } : {}),
      versions: [],
      currentVersion: 0,
      createdAt: entry.createdAt,
    },
    version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "failed", error },
  };
}

export const mockApi = {
  health: async () => {
    if (mockUpdateDown) throw new Error("mock service restarting");
    return { ok: true as const, version: "mock", build: mockUpdateBuild() };
  },

  repos: async (): Promise<ReposResponse> => ({ repos: getRepos() }),

  addRepo: async (body: AddRepoRequest): Promise<AddRepoResponse> => {
    // #27: mirror the service contract — path adds a local checkout, url
    // clones a managed repo. Test hooks: `unvibe.mock.addRepoHold` holds
    // the clone so specs can observe the busy state,
    // `unvibe.mock.addRepoDelayMs` sets extra latency (default 150 ms),
    // `unvibe.mock.addRepoFail` fails with that error text. Invalid URLs
    // 400 like the service (the UI validates first with the same parser).
    const raw = body.url ?? body.path ?? "";
    if (body.url) {
      let parsed: { owner: string; name: string; prNumber?: number };
      try {
        parsed = parseGitHubRepoInput(raw);
      } catch (err) {
        throw new Error(`POST /api/repos: 400 ${JSON.stringify({ error: (err as Error).message })}`);
      }
      await awaitAddRelease();
      await wait(addRepoDelayMs());
      const forced = addRepoFailure();
      if (forced) {
        throw new Error(`POST /api/repos: 404 ${JSON.stringify({ error: forced })}`);
      }
      const { owner, name, prNumber } = parsed;
      const repo: Repo = {
        id: `managed-${owner.toLowerCase()}-${name.toLowerCase()}`,
        owner,
        name,
        localPath: `/mock/data/repos/${owner.toLowerCase()}/${name.toLowerCase()}`,
        lastOpened: Date.now(),
        managed: true,
      };
      try {
        const added = readJson<Repo[]>(ADDED_KEY, []);
        if (!added.some((r) => r.id === repo.id)) {
          localStorage.setItem(ADDED_KEY, JSON.stringify([repo, ...added]));
        }
      } catch {
        // Non-fatal.
      }
      const out: AddRepoResponse = { repos: getRepos() };
      if (prNumber !== undefined) out.prNumber = prNumber;
      return out;
    }
    const name = raw.split("/").filter(Boolean).pop() ?? raw;
    const repo: Repo = {
      id: `local-${name}`,
      owner: "local",
      name,
      localPath: raw,
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

  removeRepo: async (id: string): Promise<RemoveRepoResponse> => {
    // #27: mirror the service — refuse while mock reviews reference the
    // repo (the seed urllib3 repo has sessions, so removing it 409s).
    const reviews = mockSummaries();
    const n = reviews.filter((r) => r.repoId === id).length;
    if (n > 0) {
      const repo = getRepos().find((r) => r.id === id);
      const label = repo ? `${repo.owner}/${repo.name}` : id;
      throw new Error(
        `DELETE /api/repos/${id}: 409 ${JSON.stringify({ error: `repo ${label} still has ${n} review${n === 1 ? "" : "s"} — delete ${n === 1 ? "it" : "them"} first, then remove the repo` })}`,
      );
    }
    try {
      const added = readJson<Repo[]>(ADDED_KEY, []);
      const found = added.find((r) => r.id === id);
      localStorage.setItem(ADDED_KEY, JSON.stringify(added.filter((r) => r.id !== id)));
      return { ok: true as const, removedClone: found?.managed === true };
    } catch {
      return { ok: true as const, removedClone: false };
    }
  },

  /** Mock folder dialog (#26): pretends the user picked a checkout. */
  pickFolder: async (): Promise<PickFolderResponse> => {
    await wait(50);
    return { status: "picked", path: "/mock/picked/checkout" };
  },

  repoChanges: async (id: string, filter?: ChangesFilter): Promise<RepoChangesResponse> => {
    // Test-only hooks for the start page (all no-ops unless set):
    // - `unvibe.mock.repoChangesHold`: when present, hold every repo-lists
    //   response until the key is removed, so specs can observe the loading
    //   state (the repo-less demo entry is never held);
    // - `unvibe.mock.repoChangesFail`: JSON array of filters to reject
    //   (e.g. ["authoring","review-requested","recent"]), each with a
    //   service-shaped 500 carrying a mock gh error.
    // - `unvibe.mock.repoChangesFetchError`: when present, every response
    //   carries it as `fetchError` (stale managed clone, like the service).
    if (id !== "demo") await awaitChangesRelease();
    const failing = readChangesFailures();
    const key = filter ?? "all";
    if (failing.includes(key)) {
      throw new Error(`GET /api/repos/${id}/changes?filter=${key}: 500 {"error":"mock gh is down"}`);
    }
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
        // #91: `gh search prs` has no head-branch field, so PR rows arrive
        // without `branch` — keep one branch-less row so the row text
        // (no "undefined", no dangling separator) stays exercised.
        kind: "pr",
        title: "Fix retry backoff on 429s",
        prNumber: 5011,
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
    // Demo entry point: the start page fetches `repoChanges("demo")` and
    // renders `kind: "demo"` changes as a row inside the Reviews list (no
    // tokens, same pipeline path). Like the service, the demo answers no
    // filtered section.
    if (id === "demo") {
      return {
        changes: [
          {
            kind: "demo",
            title: "Demo: urllib3#5020 — Unfold obsolete folded response headers",
            demo: "urllib3-5020",
          },
        ],
      };
    }
    switch (filter) {
      case "authoring":
        return withFetchNote({ changes: authoring });
      case "review-requested":
        return withFetchNote({ changes: requested });
      case "branches":
        return withFetchNote({ changes: branches });
      case "recent":
        return withFetchNote({ changes: [...branches, ...previous] });
      default:
        return withFetchNote({ changes: [...authoring, ...requested, ...branches, ...previous] });
    }

    /** Attach the stale-clone note when the `repoChangesFetchError` hook is set. */
    function withFetchNote(res: RepoChangesResponse): RepoChangesResponse {
      const note = changesFetchError();
      return note ? { ...res, fetchError: note } : res;
    }
  },

  createReview: async (body: CreateReviewRequest): Promise<ReviewSnapshot> => {
    // #92 hooks for Playwright (mock mode):
    // - `unvibe.mock.createReviewHold`: return a loading snapshot that stays
    //   loading until the key is removed (then `review()` serves ready).
    // - `unvibe.mock.createReviewFail`: return a failed snapshot with that
    //   error text (retry succeeds once the key is removed).
    let hold = false;
    let fail: string | null = null;
    try {
      hold = localStorage.getItem("unvibe.mock.createReviewHold") !== null;
      fail = localStorage.getItem("unvibe.mock.createReviewFail");
      if (fail === "") fail = null;
    } catch {
      // Ignore.
    }
    if (fail) {
      const id = `mock-failed-${Date.now().toString(36)}`;
      const title =
        typeof body.title === "string" && body.title.trim() !== ""
          ? body.title
          : body.pr !== undefined
            ? `PR #${body.pr}`
            : (body.branch ?? "review");
      const branch = body.branch ?? (body.pr !== undefined ? `pr-${body.pr}` : "branch");
      mockReviewList.unshift({
        id,
        repoId: body.repoId,
        repoOwner: "mock",
        repoName: "mock",
        title,
        branch,
        ...(body.pr !== undefined ? { prNumber: body.pr } : {}),
        createdAt: Date.now(),
        lastOpened: Date.now(),
        versionCount: 0,
        currentVersion: 0,
        stale: false,
        totalHunks: 0,
        reviewedHunks: 0,
        pendingComments: 0,
        guideStatus: "idle",
        ingestStatus: "failed",
        ingestError: fail,
      });
      const now = Date.now();
      return {
        review: {
          id,
          repoId: body.repoId,
          branch,
          ...(body.pr !== undefined ? { prNumber: body.pr } : {}),
          versions: [],
          currentVersion: 0,
          createdAt: now,
        },
        version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
        files: [],
        pages: [],
        annotations: [],
        hunkStates: [],
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
        ingest: { status: "failed", error: fail },
      };
    }
    if (hold) {
      const id = `mock-loading-${Date.now().toString(36)}`;
      const title =
        typeof body.title === "string" && body.title.trim() !== ""
          ? body.title
          : body.pr !== undefined
            ? `PR #${body.pr}`
            : (body.branch ?? "review");
      const branch = body.branch ?? (body.pr !== undefined ? `pr-${body.pr}` : "branch");
      const step = "fetching";
      mockReviewList.unshift({
        id,
        repoId: body.repoId,
        repoOwner: "mock",
        repoName: "mock",
        title,
        branch,
        ...(body.pr !== undefined ? { prNumber: body.pr } : {}),
        createdAt: Date.now(),
        lastOpened: Date.now(),
        versionCount: 0,
        currentVersion: 0,
        stale: false,
        totalHunks: 0,
        reviewedHunks: 0,
        pendingComments: 0,
        guideStatus: "idle",
        ingestStatus: "loading",
        ingestStep: step,
      });
      const now = Date.now();
      return {
        review: {
          id,
          repoId: body.repoId,
          branch,
          ...(body.pr !== undefined ? { prNumber: body.pr } : {}),
          versions: [],
          currentVersion: 0,
          createdAt: now,
        },
        version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
        files: [],
        pages: [],
        annotations: [],
        hunkStates: [],
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
        ingest: { status: "loading", step },
      };
    }
    await wait(150);
    return currentSnapshot("demo");
  },

  retryReview: async (id: string): Promise<ReviewSnapshot> => {
    await wait(100);
    let fail: string | null = null;
    try {
      fail = localStorage.getItem("unvibe.mock.createReviewFail");
      if (fail === "") fail = null;
    } catch {
      // Ignore.
    }
    const entry = mockReviewList.find((r) => r.id === id);
    if (!entry) throw new Error(`POST /api/reviews/${id}/retry: 404 {"error":"unknown review"}`);
    if (entry.ingestStatus === "loading") {
      // Already running — return the loading snapshot.
      return mockLoadingSnapshot(entry);
    }
    if (fail) {
      entry.ingestStatus = "failed";
      entry.ingestError = fail;
      delete entry.ingestStep;
      return mockFailedSnapshot(entry, fail);
    }
    delete entry.ingestStatus;
    delete entry.ingestStep;
    delete entry.ingestError;
    entry.versionCount = 1;
    entry.currentVersion = 1;
    entry.guideStatus = "ready";
    return currentSnapshot(id);
  },

  reviews: async (): Promise<ReviewsListResponse> => {
    await wait(50);
    return { reviews: mockSummaries() };
  },

  deleteReview: async (id: string): Promise<{ ok: boolean }> => {
    await wait(50);
    const i = mockReviewList.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`DELETE /api/reviews/${id}: 404 {"error":"unknown review"}`);
    mockReviewList.splice(i, 1);
    return { ok: true };
  },

  resetData: async (): Promise<ResetDataResponse> => {
    await wait(50);
    const reviewsRemoved = mockReviewList.length;
    mockReviewList.length = 0;
    return { ok: true, reviewsRemoved };
  },

  readiness: async (): Promise<ReadinessResponse> => {
    await wait(50);
    return readMockReadiness();
  },

  diagramSvg: async (
    _reviewId: string,
    hash: string,
    theme: "light" | "dark",
  ): Promise<string> => {
    await wait(30);
    return mockDiagramSvg(hash, theme);
  },

  review: async (id: string, version?: number): Promise<ReviewSnapshot> => {
    await wait(50);
    // #92: mock loading/failed reviews — stateless by id prefix + hooks so
    // the status survives SPA navigation even if the list entry is gone.
    try {
      if (id.startsWith("mock-loading-")) {
        const hold = localStorage.getItem("unvibe.mock.createReviewHold") !== null;
        const entry = mockReviewList.find((r) => r.id === id);
        if (hold) {
          if (entry) return mockLoadingSnapshot(entry);
          const now = Date.now();
          return {
            review: { id, repoId: "urllib3", branch: "feature", versions: [], currentVersion: 0, createdAt: now },
            version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
            files: [],
            pages: [],
            annotations: [],
            hunkStates: [],
            jobs: [],
            contributions: [],
            logTail: [],
            rev: 1,
            ingest: { status: "loading", step: "fetching" },
          };
        }
        if (entry) {
          delete entry.ingestStatus;
          delete entry.ingestStep;
          entry.versionCount = 1;
          entry.currentVersion = 1;
          entry.guideStatus = "ready";
        }
        return currentSnapshot(id, version);
      }
      if (id.startsWith("mock-failed-")) {
        const fail = localStorage.getItem("unvibe.mock.createReviewFail");
        const entry = mockReviewList.find((r) => r.id === id);
        if (fail) {
          if (entry) return mockFailedSnapshot(entry, fail);
          const now = Date.now();
          return {
            review: { id, repoId: "urllib3", branch: "feature", versions: [], currentVersion: 0, createdAt: now },
            version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
            files: [],
            pages: [],
            annotations: [],
            hunkStates: [],
            jobs: [],
            contributions: [],
            logTail: [],
            rev: 1,
            ingest: { status: "failed", error: fail },
          };
        }
        if (entry) {
          delete entry.ingestStatus;
          delete entry.ingestError;
          entry.versionCount = 1;
          entry.currentVersion = 1;
          entry.guideStatus = "ready";
        }
        return currentSnapshot(id, version);
      }
    } catch {
      // Fall through to the list lookup below.
    }
    // #92: mock loading/failed reviews (created via the hold/fail hooks).
    const entry = mockReviewList.find((r) => r.id === id);
    if (entry?.ingestStatus === "loading") {
      let hold = false;
      try {
        hold = localStorage.getItem("unvibe.mock.createReviewHold") !== null;
      } catch {
        // Ignore.
      }
      if (hold) return mockLoadingSnapshot(entry);
      // Hold released: the ingest lands — flip to ready like the service.
      delete entry.ingestStatus;
      delete entry.ingestStep;
      entry.versionCount = 1;
      entry.currentVersion = 1;
      entry.guideStatus = "ready";
      return currentSnapshot(id, version);
    }
    if (entry?.ingestStatus === "failed") {
      let fail: string | null = null;
      try {
        fail = localStorage.getItem("unvibe.mock.createReviewFail");
        if (fail === "") fail = null;
      } catch {
        // Ignore.
      }
      const error = fail ?? entry.ingestError ?? "mock ingest failed";
      return mockFailedSnapshot(entry, error);
    }
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
    const jobId = `mock-update-${id}`;
    trackMockJob(jobId, "update-pass");
    window.setTimeout(() => settleMockJob(jobId), 800);
    return { jobId, toVersion: isStaleReview(id) ? 2 : 1 };
  },

  action: async (_id: string, a: ReviewAction): Promise<ActionResponse> => {
    // Second opinion (mock): canned verdicts through the patch path so
    // mock-mode e2e exercises the result block, disagreement styling and
    // the mode switch without a service. Blind → partly, check →
    // disagrees (prominent warn styling).
    if (a.kind === "second_opinion") {
      const jobId = `mock-so-${a.cardId}-${a.mode}`;
      const verdict = a.mode === "blind" ? "partly" : "disagrees";
      const missed =
        a.mode === "blind" ? "A lone CR ending is untested too." : "Set-Cookie comma handling is out of scope.";
      const result = {
        id: `so-${a.cardId}-${a.mode}-mock-second`,
        cardId: a.cardId,
        mode: a.mode,
        provider: "codex",
        model: "mock-second",
        verdict,
        reasoning: verdict === "partly" ? "Checked the helper; gap is real but narrow." : "Only CRLF-folded values are rewritten.",
        blocks: [
          {
            type: "paragraph",
            id: "b-so-1",
            text: {
              standard:
                verdict === "partly"
                  ? `Partly — the gap is real but narrow. The helper handles the fold. [[diff:src-urllib3-connection.py:80-82]]`
                  : `Disagrees — only CRLF-folded values are rewritten. [[diff:src-urllib3-connection.py:80-88]]`,
            },
            citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
          },
        ],
        missed,
        version: 1,
        createdAt: Date.now(),
        jobId,
      };
      trackMockJob(jobId, "second-opinion", { cardId: a.cardId });
      window.setTimeout(() => {
        settleMockJob(jobId);
        // Expansions store the result on the expansion body (survives
        // depth/undo); page cards store on the card.
        const exp = annotations.find((x) => x.id === a.cardId && x.type === "expansion");
        if (exp?.expansion) {
          const rest = (exp.expansion.secondOpinions ?? []).filter((s) => (s as { mode: string }).mode !== a.mode);
          exp.expansion.secondOpinions = [...rest, { ...result, cardId: exp.id } as never];
          emitAnnotations();
          return;
        }
        const snap = useReview.getState().snapshot;
        if (!snap) return;
        const pages = snap.pages.map((p) => ({
          ...p,
          cards: p.cards.map((c) => {
            if (c.id !== a.cardId) return c;
            const rest = (c.secondOpinions ?? []).filter((s) => s.mode !== a.mode);
            return {
              ...c,
              secondOpinions: [...rest, { ...result, cardId: c.id } as never],
            };
          }),
        }));
        mockPages = JSON.parse(JSON.stringify(pages));
        emitPages();
      }, 400);
      return { accepted: true, jobId };
    }
    if (a.kind === "delete") {
      const target = (a as { targetId?: string }).targetId ?? "";
      const m = target.match(/^second-opinion:([^:]+):(blind|check)$/) ?? target.match(/^(so-.*)$/);
      if (m) {
        // Expansion results first (stored on the expansion body).
        let removedExp = false;
        for (const ann of annotations) {
          if (ann.type !== "expansion" || !ann.expansion) continue;
          const before = ann.expansion.secondOpinions ?? [];
          let after = before;
          if (m[1].startsWith("so-")) {
            after = before.filter((s) => (s as { id: string }).id !== m[1]);
          } else {
            const mm = target.match(/^second-opinion:([^:]+):(blind|check)$/)!;
            if (ann.id !== mm[1]) continue;
            after = before.filter((s) => (s as { mode: string }).mode !== mm[2]);
          }
          if (after.length !== before.length) {
            ann.expansion.secondOpinions = after as never;
            removedExp = true;
          }
        }
        if (removedExp) {
          emitAnnotations();
          return { accepted: true };
        }
        const snap = useReview.getState().snapshot;
        if (!snap) return { accepted: false };
        const pages = snap.pages.map((p) => ({
          ...p,
          cards: p.cards.map((c) => {
            const before = c.secondOpinions ?? [];
            if (m[1].startsWith("so-")) {
              const after = before.filter((s) => s.id !== m[1]);
              return after.length === before.length ? c : { ...c, secondOpinions: after };
            }
            const [, cardId, mode] = target.match(/^second-opinion:([^:]+):(blind|check)$/)!;
            if (c.id !== cardId) return c;
            return { ...c, secondOpinions: before.filter((s) => s.mode !== mode) };
          }),
        }));
        mockPages = JSON.parse(JSON.stringify(pages));
        emitPages();
        return { accepted: true };
      }
      // Annotation deletion (expansions + threads via the actions route).
      const annIdx = annotations.findIndex((x) => x.id === target);
      if (annIdx >= 0) {
        annotations.splice(annIdx, 1);
        emitAnnotations();
        return { accepted: true, annotationId: target };
      }
      throw new Error(`DELETE actions ${target}: 404 {"error":"unknown annotation"}`);
    }
    // Ask turns (M4): create/answer through the patch path like the
    // service (working flag, delayed canned answer, patch delivery).
    if (a.kind === "ask" || a.kind === "reply" || a.kind === "retry") {
      const answerLater = (tid: string, text: string, quote: string, jobId: string): void => {
        void wait(700).then(() => {
          settleMockJob(jobId);
          const target = annotations.find((x) => x.id === tid);
          if (!target || target.type !== "thread") return;
          target.messages.push({ who: "ai", html: mockAnswerFor(text, quote) });
          target.working = null;
          target.open = true;
          emitAnnotations();
        });
      };
      if (a.kind === "reply" || a.kind === "retry") {
        const threadId = a.threadId;
        const thread = annotations.find((x) => x.id === threadId);
        // Expansion retry refills the expansion in place (same id).
        if (thread?.type === "expansion" && thread.expansion && a.kind === "retry") {
          thread.error = null;
          thread.expansion.error = null;
          thread.working = "Thinking…";
          thread.expansion.working = "Thinking…";
          thread.open = true;
          emitAnnotations();
          const tid = thread.id;
          const quote = thread.anchor.quotedText;
          const retryJobId = `mock-retry-${thread.id}`;
          trackMockJob(retryJobId, "ask", { cardId: thread.id, threadId: thread.id });
          window.setTimeout(() => {
            settleMockJob(retryJobId);
            const live = annotations.find((x) => x.id === tid);
            if (!live || live.type !== "expansion" || !live.expansion) return;
            live.expansion.blocks = mockExplainBlocks(quote) as never;
            live.expansion.revision += 1;
            live.working = null;
            live.expansion.working = null;
            emitAnnotations();
          }, 700);
          return { accepted: true, annotationId: thread.id, threadId: thread.id, jobId: retryJobId };
        } else {
          if (!thread || thread.type !== "thread") throw new Error(`unknown comment ${threadId}`);
          if (a.kind === "retry" && !thread.error) throw new Error(`thread ${thread.id} has no failed reply to retry`);
          if (a.kind === "reply") {
            thread.messages.push({ who: "you", text: a.message });
          }
          thread.error = null;
          thread.working = "Reading…";
          thread.open = true;
          emitAnnotations();
          const lastYou = [...thread.messages].reverse().find((m) => m.who === "you" && m.text);
          const threadJobId = `mock-${a.kind}-${thread.id}`;
          trackMockJob(threadJobId, "ask", { threadId: thread.id });
          answerLater(thread.id, lastYou?.text ?? "", thread.anchor.quotedText, threadJobId);
          return { accepted: true, annotationId: thread.id, threadId: thread.id, jobId: threadJobId };
        }
      }
      if (a.kind === "ask") {
        const anchor = a.anchor;
        const host =
          anchor.where === "block"
            ? { kind: "block", blockId: anchor.blockId }
            : anchor.where === "description"
              ? { kind: "description", paragraphId: anchor.paragraphId }
              : { kind: "diff-line", fileKey: anchor.fileKey, line: anchor.line };
        const thread: import("@unvibe/shared").Annotation = {
          id: `ann_mock${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`,
          type: "thread",
          anchor: {
            host: host as import("@unvibe/shared").Annotation["anchor"]["host"],
            quotedText: a.quote,
            prefix: "",
            suffix: "",
            position: 0,
            version: 1,
          },
          open: host.kind === "block" ? false : true,
          messages: [{ who: "you", text: a.message }],
          post: false,
          note: false,
          working: "Reading…",
        };
        annotations.push(thread);
        emitAnnotations();
        const askJobId = `mock-ask-${thread.id}`;
        trackMockJob(askJobId, "ask", { threadId: thread.id });
        answerLater(thread.id, a.message, a.quote, askJobId);
        return { accepted: true, annotationId: thread.id, threadId: thread.id, jobId: askJobId };
      }
    }
    // M4 interaction (mock): explain, depth, examples, diagram, undo,
    // generate, followup, concept, promote, close + instant card state.
    // Canned content derives from the fixture snapshot so the UI exercises
    // the real shapes (working → streamed text → blocks, error + retry via
    // `retry`, anchor-stale fallback, dotted-link close).
    if (a.kind === "explain") {
      const anchor = a.anchor;
      const host =
        anchor.where === "block"
          ? { kind: "block", blockId: anchor.blockId }
          : anchor.where === "description"
            ? { kind: "description", paragraphId: anchor.paragraphId }
            : { kind: "diff-line", fileKey: anchor.fileKey, line: anchor.line };
      const id = `ann_mock${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
      const jobId = `mock-explain-${id}`;
      annotations.push({
        id,
        type: "expansion",
        anchor: {
          host: host as import("@unvibe/shared").Annotation["anchor"]["host"],
          quotedText: a.quote,
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: true,
        messages: [],
        post: false,
        note: false,
        working: "Thinking…",
        expansion: {
          blocks: [],
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          undoStack: [],
          working: "Thinking…",
        },
      } as unknown as import("@unvibe/shared").Annotation);
      emitAnnotations();
      trackMockJob(jobId, "explain", { threadId: id });
      window.setTimeout(() => {
        settleMockJob(jobId);
        const found = annotations.find((x) => x.id === id);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        if (!found.open) {
          // Closed while filling: keep content for the dotted-link preview.
          found.expansion.blocks = mockExplainBlocks(a.quote) as never;
          found.expansion.revision += 1;
          found.working = null;
          found.expansion.working = null;
          emitAnnotations();
          return;
        }
        found.expansion.blocks = mockExplainBlocks(a.quote) as never;
        found.expansion.revision += 1;
        found.working = null;
        found.expansion.working = null;
        found.error = null;
        found.expansion.error = null;
        emitAnnotations();
      }, 700);
      return { accepted: true, annotationId: id, jobId };
    }
    if (a.kind === "depth" || a.kind === "examples" || a.kind === "diagram" || a.kind === "undo") {
      const res = mockCardControl(a as never);
      return res as ActionResponse;
    }
    if (a.kind === "generate") {
      const card = mockPages.flatMap((p) => p.cards).find((c) => c.id === a.cardId);
      if (!card) throw new Error(`unknown card ${a.cardId}`);
      if (!card.pending) return { accepted: true, jobId: `mock-generate-${card.id}` };
      const jobId = `mock-generate-${card.id}`;
      trackMockJob(jobId, "go-deeper", { cardId: card.id });
      window.setTimeout(() => {
        settleMockJob(jobId);
        const target = mockPages.flatMap((p) => p.cards).find((c) => c.id === card.id);
        if (!target || !target.pending) return;
        delete target.pending;
        target.blocks = [
          {
            type: "paragraph",
            id: `${card.id}-b1`,
            text: { standard: `Mock generated card for <em>${card.id}</em>: the live agent would fill this from the repo. [[diff:src-urllib3-connection.py:80-82]]` },
            citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
          },
          { type: "follow-up", id: `${card.id}-f1`, items: [{ label: "What happens to a fold that ends in a bare LF?", ask: "bare lf" }], citations: [] },
        ] as never;
        target.revision += 1;
        emitPages();
      }, 700);
      return { accepted: true, jobId };
    }
    if (a.kind === "followup") {
      const { cardId, blockId, index } = a as { cardId: string; blockId: string; index: number };
      const holder = mockPages.flatMap((p) => p.cards).find((c) => c.id === cardId);
      const block = holder?.blocks.find((b) => b.id === blockId && b.type === "follow-up") as
        | { items: { label: string; ask?: string }[] }
        | undefined;
      if (!block || !block.items[index]) throw new Error(`unknown follow-up ${index} on block ${blockId}`);
      const item = block.items[index];
      block.items.splice(index, 1);
      emitPages();
      const id = `ann_mock${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
      const jobId = `mock-followup-${id}`;
      annotations.push({
        id,
        type: "expansion",
        anchor: {
          host: { kind: "block", blockId },
          quotedText: item.label,
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: true,
        messages: [],
        post: false,
        note: false,
        working: "Thinking…",
        expansion: { blocks: [], level: "standard", read: false, collapsed: false, revision: 1, undoStack: [], working: "Thinking…" },
      } as unknown as import("@unvibe/shared").Annotation);
      emitAnnotations();
      trackMockJob(jobId, "ask", { cardId, threadId: id });
      window.setTimeout(() => {
        settleMockJob(jobId);
        const found = annotations.find((x) => x.id === id);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        found.expansion.blocks = mockExplainBlocks(item.label) as never;
        found.expansion.revision += 1;
        found.working = null;
        found.expansion.working = null;
        emitAnnotations();
      }, 700);
      return { accepted: true, annotationId: id, cardId, jobId };
    }
    if (a.kind === "concept") {
      const slug = (a as { slug: string }).slug;
      const pageId = `c-${slug}`;
      let page = mockPages.find((p) => p.id === pageId);
      if (page && (page.cards[0]?.blocks.length ?? 0) > 1) return { accepted: true, pageId };
      if (!page) {
        mockPages.push({
          id: pageId,
          kind: "concept",
          title: slug,
          saved: true,
          parent: "root",
          cards: [{ id: `cc-${slug}`, pageId, title: null, level: "standard", read: false, collapsed: false, revision: 1, blocks: [], undoStack: [] }],
        });
        emitPages();
        page = mockPages.find((p) => p.id === pageId)!;
      }
      const jobId = `mock-concept-${slug}`;
      trackMockJob(jobId, "concept", { cardId: `cc-${slug}`, dedupeKey: `concept:${slug}|concept-page||v1` });
      window.setTimeout(() => {
        settleMockJob(jobId);
        const live = mockPages.find((p) => p.id === pageId);
        if (!live) return;
        live.title = `${slug} (mock concept)`;
        live.cards = [
          {
            id: `cc-${slug}`,
            pageId,
            title: null,
            level: "standard",
            read: false,
            collapsed: false,
            revision: 2,
            blocks: [
              { type: "paragraph", id: `cc-${slug}-b1`, text: { standard: `Mock concept page for <em>${slug}</em>: written on first open. [[diff:src-urllib3-connection.py:80-82]]` }, citations: [{ target: "diff:src-urllib3-connection.py:80-82" }] },
            ] as never,
            undoStack: [],
          },
        ];
        emitPages();
      }, 700);
      return { accepted: true, pageId, jobId };
    }
    if (a.kind === "promote") {
      const annId = (a as { annotationId: string }).annotationId;
      const found = annotations.find((x) => x.id === annId);
      if (!found || found.type !== "expansion" || !found.expansion) throw new Error(`annotation ${annId} is not an expansion`);
      const quote = found.anchor.quotedText;
      const title = quote.length > 60 ? `${quote.slice(0, 58)}…` : quote || "(untitled)";
      const pageId = `p-mock-${Date.now().toString(36)}`;
      const cardId = `c-mock-${Date.now().toString(36)}`;
      mockPages.push({
        id: pageId,
        kind: "opened-expansion",
        title,
        saved: false,
        parent: "root",
        cards: [{ id: cardId, pageId, title: null, level: found.expansion.level, read: false, collapsed: false, revision: 1, blocks: JSON.parse(JSON.stringify(found.expansion.blocks)), undoStack: [] }],
      });
      found.type = "link" as never;
      found.open = false;
      found.working = null;
      found.error = null;
      found.jobId = undefined;
      (found as { promotedToPage?: string }).promotedToPage = pageId;
      delete (found as { expansion?: unknown }).expansion;
      emitPages();
      emitAnnotations();
      return { accepted: true, annotationId: annId, pageId };
    }
    if (a.kind === "close") {
      const annId = (a as { annotationId: string }).annotationId;
      const found = annotations.find((x) => x.id === annId);
      if (!found) throw new Error(`unknown annotation ${annId}`);
      found.open = false;
      found.working = null;
      if (found.type === "expansion" && found.expansion) found.expansion.working = null;
      emitAnnotations();
      return { accepted: true, annotationId: annId };
    }
    // Guide instant state (PRD §4.3/§4.4) applies locally through the patch
    // path — page cards and expansion cards alike.
    // (Expansion retries are handled in the ask/reply/retry branch above.)
    if (a.kind !== "read" && a.kind !== "collapse" && a.kind !== "bookmark") {
      return { accepted: false };
    }
    if (a.kind === "bookmark") {
      const page = mockPages.find((p) => p.id === (a as { pageId: string }).pageId);
      if (!page) return { accepted: false };
      page.saved = (a as { saved: boolean }).saved;
      emitPages();
      return { accepted: true };
    }
    // read / collapse on page cards…
    for (const p of mockPages) {
      for (const c of p.cards) {
        if (c.id !== (a as { cardId: string }).cardId) continue;
        if (a.kind === "read") {
          c.read = (a as { read: boolean }).read;
          c.collapsed = (a as { read: boolean }).read ? true : false;
        } else {
          c.collapsed = (a as { collapsed: boolean }).collapsed;
        }
        emitPages();
        return { accepted: true };
      }
    }
    // …and on expansion cards (marking read closes like Close does).
    {
      const ann = annotations.find((x) => x.id === (a as { cardId: string }).cardId);
      if (ann?.type === "expansion" && ann.expansion) {
        if (a.kind === "read") {
          const read = (a as { read: boolean }).read;
          ann.expansion.read = read;
          if (read) {
            ann.expansion.collapsed = true;
            ann.open = false;
            ann.working = null;
            ann.expansion.working = null;
          } else {
            ann.expansion.collapsed = false;
            ann.open = true;
          }
        } else {
          ann.expansion.collapsed = (a as { collapsed: boolean }).collapsed;
        }
        emitAnnotations();
        return { accepted: true };
      }
    }
    return { accepted: false };
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

  createComment: async (
    _id: string,
    body: import("@unvibe/shared").CreateCommentRequest,
  ): Promise<{ id: string }> => {
    const anchor = body.anchor;
    const host =
      anchor.where === "block"
        ? { kind: "block", blockId: anchor.blockId }
        : anchor.where === "description"
          ? { kind: "description", paragraphId: anchor.paragraphId }
          : { kind: "diff-line", fileKey: anchor.fileKey, line: anchor.line };
    const thread: import("@unvibe/shared").Annotation = {
      id: `ann_mock${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`,
      type: "thread",
      anchor: {
        host: host as import("@unvibe/shared").Annotation["anchor"]["host"],
        quotedText: body.quote ?? "",
        prefix: body.prefix ?? "",
        suffix: body.suffix ?? "",
        position: body.position ?? 0,
        version: 1,
      },
      open: host.kind === "block" ? false : true,
      messages: body.text ? [{ who: "you", text: body.text }] : [],
      post: false,
      note: body.note ?? true,
    };
    if (body.suggested && body.suggestionText) {
      thread.messages = [{ who: "ai", text: body.suggestionText, suggested: true }];
      thread.note = false;
    }
    annotations.push(thread);
    emitAnnotations();
    // Ask threads (user's first message, not a Note) get a canned agent
    // reply after a delay, through the same patch path as the service seam.
    if (!thread.note && thread.messages.length > 0) {
      const first = thread.messages[0]?.text ?? "";
      const quote = thread.anchor.quotedText;
      const tid = thread.id;
      void wait(700).then(() => {
        const target = annotations.find((a) => a.id === tid);
        if (!target) return;
        target.messages.push({ who: "ai", html: mockAnswerFor(first, quote) });
        target.open = true;
        emitAnnotations();
      });
    }
    return { id: thread.id };
  },

  replyComment: async (_id: string, commentId: string, body: { text: string }) => {
    const thread = annotations.find((a) => a.id === commentId);
    if (!thread || thread.type !== "thread") throw new Error("unknown comment");
    thread.messages.push({ who: "you", text: body.text });
    delete thread.reply;
    thread.open = true;
    emitAnnotations();
    if (!thread.note) {
      const quote = thread.anchor.quotedText;
      const text = body.text;
      void wait(700).then(() => {
        const target = annotations.find((a) => a.id === commentId);
        if (!target) return;
        target.messages.push({ who: "ai", html: mockAnswerFor(text, quote) });
        emitAnnotations();
      });
    }
    return { ok: true };
  },

  updateComment: async (_id: string, commentId: string, body: import("@unvibe/shared").UpdateCommentRequest) => {
    const thread = annotations.find((a) => a.id === commentId);
    if (!thread) throw new Error("unknown comment");
    // M4 service fix: `open` applies to expansions too (dotted-link click).
    if (thread.type === "expansion") {
      if (body.open !== undefined) thread.open = body.open;
      if (body.post !== undefined || body.draft !== undefined || body.reply !== undefined) {
        throw new Error(`annotation ${commentId} is not a thread`);
      }
      emitAnnotations();
      return { ok: true };
    }
    if (thread.type !== "thread") throw new Error("unknown comment");
    if (body.post !== undefined) {
      thread.post = body.post;
      if (body.post) thread.open = true;
    }
    if (body.draft === null) delete thread.draft;
    else if (body.draft !== undefined) thread.draft = body.draft;
    if (body.open !== undefined) thread.open = body.open;
    if (body.reply === null) delete thread.reply;
    else if (body.reply !== undefined) thread.reply = body.reply;
    emitAnnotations();
    return { ok: true };
  },

  deleteComment: async (_id: string, commentId: string) => {
    const idx = annotations.findIndex((a) => a.id === commentId);
    if (idx < 0) throw new Error("unknown comment");
    annotations.splice(idx, 1);
    emitAnnotations();
    return { ok: true };
  },

  updateDescription: async (_id: string, body: { html: string }) => {
    description = {
      ...description,
      pendingHtml: body.html,
      pendingMarkdown: stripMockHtml(body.html),
    };
    emitDescription();
    return { ok: true, changed: true };
  },

  revertDescription: async () => {
    const { pendingHtml: _ph, pendingMarkdown: _pm, ...rest } = description as Record<string, unknown>;
    void _ph;
    void _pm;
    description = rest as typeof description;
    emitDescription();
    return { ok: true };
  },

  submit: async (_id: string, body?: { dryRun?: boolean }) => {
    const preview = buildMockPreview();
    if (body?.dryRun) {
      return { posted: false, commentCount: 0, descriptionUpdated: false, preview };
    }
    const at = Date.now();
    for (const c of preview.comments) {
      const thread = annotations.find((a) => a.id === c.threadId);
      if (thread && thread.type === "thread") {
        thread.postedAt = at;
        thread.postedUrl = "https://github.com/urllib3/urllib3/pull/5020#discussion_r-mock";
      }
    }
    const descriptionUpdated = description.pendingHtml !== undefined;
    if (descriptionUpdated) {
      description = {
        ...description,
        html: description.pendingHtml ?? description.html,
        baseMarkdown: description.pendingMarkdown,
      };
      const { pendingHtml: _h, pendingMarkdown: _m, ...rest } = description as Record<string, unknown>;
      void _h;
      void _m;
      description = rest as typeof description;
    }
    emitAnnotations();
    emitDescription();
    return {
      posted: true,
      commentCount: preview.comments.length,
      descriptionUpdated,
      reviewUrl: "https://github.com/urllib3/urllib3/pull/5020#pullrequestreview-mock",
    };
  },

  submitPreview: async () => ({ preview: buildMockPreview() }),

  prComments: async () => {
    emitExisting();
    return { comments: existingComments };
  },

  viewer: async () => ({ login: "you" }),

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
    const catalog: Record<string, import("@unvibe/shared").ModelInfo[]> = {
      claude: [
        { id: "mock-main", name: "Mock Main", description: "Mock main model for tests" },
        { id: "mock-small", name: "Mock Small", description: "Mock small model for tests" },
        { id: "mock-opus", name: "Mock Opus", description: "Mock opus-class model for tests" },
      ],
      codex: [
        { id: "mock-second", name: "Mock Second", description: "Mock second-opinion model" },
        { id: "mock-mini", name: "Mock Mini", description: "Mock mini model" },
      ],
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

  sharedContext: async (reviewId: string) => mockSharedContext(reviewId),

  deleteContribution: async (reviewId: string, contributionId: string) => {
    void reviewId;
    if (!mockContributions.some((c) => c.id === contributionId)) {
      throw new Error(`DELETE /api/reviews/demo/contributions/${contributionId}: 404`);
    }
    mockContributions = mockContributions.filter((c) => c.id !== contributionId);
    emitContributions();
    return { ok: true as const, deletedId: contributionId };
  },

  acceptContribution: async (reviewId: string, contributionId: string) => {
    void reviewId;
    const found = mockContributions.find((c) => c.id === contributionId);
    if (!found) throw new Error(`POST /api/reviews/demo/contributions/${contributionId}/accept: 404`);
    const correction = found.items.find((i) => i.kind === "correction");
    if (found.status !== "pending" || !correction?.target) {
      throw new Error(`POST /api/reviews/demo/contributions/${contributionId}/accept: 409 {"error":"not a pending correction"}`);
    }
    // Accept creates a new card revision (undoable): push the current blocks
    // and bump the revision on the target card when it exists in mock.
    const target = correction.target ?? "";
    const cardId = target.startsWith("card:") ? target.slice("card:".length).split("#")[0] : "central";
    const ref = findMockCard(cardId);
    let revision = 2;
    if (ref?.kind === "page") {
      ref.card.undoStack.push({ blocks: JSON.parse(JSON.stringify(ref.card.blocks)), level: ref.card.level });
      ref.card.revision += 1;
      revision = ref.card.revision;
      emitPages();
    }
    mockContributions = mockContributions.map((c) =>
      c.id === contributionId ? { ...c, status: "accepted" as const } : c,
    );
    emitContributions();
    return { ok: true as const, acceptedId: contributionId, cardId, revision };
  },

  dismissContribution: async (reviewId: string, contributionId: string) => {
    void reviewId;
    const found = mockContributions.find((c) => c.id === contributionId);
    if (!found) throw new Error(`POST /api/reviews/demo/contributions/${contributionId}/dismiss: 404`);
    if (found.status !== "pending") {
      throw new Error(`POST /api/reviews/demo/contributions/${contributionId}/dismiss: 409 {"error":"not a pending correction"}`);
    }
    mockContributions = mockContributions.map((c) =>
      c.id === contributionId ? { ...c, status: "dismissed" as const } : c,
    );
    emitContributions();
    return { ok: true as const, dismissedId: contributionId };
  },

  updateStatus: async (): Promise<UpdateStatusResponse> => {
    await wait(30);
    return {
      enabled: getMockSettings().versionPickerEnabled === true,
      build: mockUpdateBuild(),
      pending: mockUpdatePending,
      outcome: readUpdatePersisted().outcome,
    };
  },

  updateChannels: async (): Promise<{ channels: UpdateChannel[] }> => {
    await wait(80);
    if (getMockSettings().versionPickerEnabled !== true) {
      throw new Error('GET /api/update/channels: 404 {"error":"version picker is disabled"}');
    }
    return { channels: mockUpdateChannels() };
  },

  updateSwitch: async (ref: string, force?: boolean): Promise<UpdateSwitchResponse> => {
    await wait(80);
    if (getMockSettings().versionPickerEnabled !== true) {
      throw new Error('POST /api/update/switch: 404 {"error":"version picker is disabled"}');
    }
    const target = MOCK_UPDATE_CHANNELS.find((c) => c.ref === ref);
    if (!target) {
      throw new Error(`POST /api/update/switch: 404 {"error":"unknown update channel \\"${ref}\\""}`);
    }
    if (mockUpdatePending) {
      throw new Error(
        `POST /api/update/switch: 409 {"error":"a switch to \\"${mockUpdatePending.to}\\" is already in progress"}`,
      );
    }
    // Running-jobs refusal (#36 follow-up): opt-in via localStorage
    // `unvibe.mock.update.blockJobs` ("1"), refused from the live mock job
    // list unless forced — so mock-mode specs exercise the refused →
    // switch-anyway flow without breaking the plain switch specs.
    const blockJobs = (() => {
      try {
        return localStorage.getItem(UPDATE_BLOCK_JOBS_KEY) === "1";
      } catch {
        return false;
      }
    })();
    const active = mockJobs.filter((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
    if (blockJobs && active.length > 0 && force !== true) {
      const jobs = active.slice(0, 5).map((j) => ({
        id: j.id,
        kind: j.kind,
        ...(j.reviewId !== undefined ? { reviewId: j.reviewId } : {}),
        state: j.state,
        ...((j.progress ?? j.cardId ?? j.threadId) ? { label: (j.progress ?? j.cardId ?? j.threadId) as string } : {}),
      }));
      throw new UpdateJobsBlockedError(
        active.length,
        jobs,
        `cannot switch while ${active.length} job${active.length === 1 ? " is" : "s are"} running; wait for them to finish, then retry`,
      );
    }
    const { current: from } = readUpdatePersisted();
    if (from === ref) {
      // Same channel, same published commit in mock: nothing to do.
      return { from, to: ref, unchanged: true };
    }
    mockUpdatePending = { from, to: ref, startedAt: new Date().toISOString() };
    mockUpdateDown = true;
    // Forced with jobs running: the shutdown path stops them; the count
    // rides the outcome so the UI names it after the reload.
    const interruptedJobs = force === true && active.length > 0 ? active.length : undefined;
    const fail = (() => {
      try {
        return localStorage.getItem(UPDATE_FAIL_KEY);
      } catch {
        return null;
      }
    })();
    window.setTimeout(() => {
      const at = new Date().toISOString();
      if (!fail) {
        writeUpdatePersisted({
          current: ref,
          outcome: {
            status: "ok",
            from,
            to: ref,
            finishedAt: at,
            ...(interruptedJobs !== undefined ? { interruptedJobs } : {}),
          },
        });
      } else if (fail === "fatal") {
        writeUpdatePersisted({
          current: from,
          outcome: {
            status: "failed",
            from,
            to: ref,
            reason: `Mock install of ${ref} failed and the rollback did not come up (simulated)`,
            finishedAt: at,
          },
        });
      } else {
        writeUpdatePersisted({
          current: from,
          outcome: {
            status: "rolled-back",
            from,
            to: ref,
            reason:
              fail === "install"
                ? `Mock install of ${ref} failed (simulated); restored the pre-switch backup`
                : `Mock build of ${ref} never reported ${target.version ?? "a version"} (simulated); restored the pre-switch backup`,
            finishedAt: at,
          },
        });
      }
      mockUpdatePending = null;
      mockUpdateDown = false;
    }, 900);
    return { from, to: ref };
  },

  diagnostics: async () => {
    await wait(50);
    return buildMockDiagnostics();
  },

  reload: async () => {
    await wait(100);
    const diagnostics = buildMockDiagnostics();
    return { ok: true as const, generatedAt: Date.now(), changed: ["no changes"], detail: ["Mock reload: nothing changed."], diagnostics };
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
