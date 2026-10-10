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
  CreateReviewRequest,
  HunkState,
  Job,
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
  Version,
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

let rev = 1;
const hunkStates = seedHunkStates();
let annotations: import("@unvibe/shared").Annotation[] = JSON.parse(
  JSON.stringify(MOCK_ANNOTATIONS),
) as import("@unvibe/shared").Annotation[];
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

/**
 * Test-only: reset hunk states and the snapshot revision to the seeded
 * fixture (component tests share this module's in-memory state).
 */
export function resetMockState(): void {
  hunkStates.clear();
  for (const [k, v] of seedHunkStates()) hunkStates.set(k, v);
  annotations = JSON.parse(JSON.stringify(MOCK_ANNOTATIONS));
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
  rev = 1;
}

function currentSnapshot(reviewId = "demo"): ReviewSnapshot {
  return {
    review: { ...MOCK_REVIEW, id: reviewId },
    version: MOCK_VERSION,
    files: MOCK_FILES,
    description,
    pages: MOCK_PAGES,
    annotations,
    hunkStates: [...hunkStates.values()],
    jobs: [] as Job[],
    contributions: [],
    logTail: [],
    rev,
    existingComments,
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

  review: async (id: string): Promise<ReviewSnapshot> => {
    await wait(50);
    return currentSnapshot(id);
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
    if (!thread || thread.type !== "thread") throw new Error("unknown comment");
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

  settings: async (): Promise<Settings> => ({
    main: { provider: "claude", model: "mock-main" },
    small: { provider: "claude", model: "mock-small" },
    secondOpinion: { provider: "codex", model: "mock-second" },
    sessionsPerProvider: 4,
    inlineBudgetTokens: 40000,
    rebuildSupersededRatio: 0.2,
    rebuildAppendedTokens: 10000,
    cacheLifetimeMs: 300000,
    idleExitMinutes: 10,
  }),

  saveSettings: async (body: Settings): Promise<Settings> => body,

  prompts: async () => ({ templates: [] }),

  jobs: async () => ({ jobs: [] }),
} satisfies ApiClient;
