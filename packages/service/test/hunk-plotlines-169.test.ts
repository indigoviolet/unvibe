/**
 * Issue #169: hunk interestingness scores + change plotlines from the
 * agents Unvibe already runs.
 *
 * - The hunk pass returns a score with its summary and hide reason
 *   (valid and invalid values); the deterministic rules apply on top
 *   (guide-cited never hidden, one-line never mechanical, hiding still
 *   follows `hiddenReason` alone).
 * - The reader names plotlines with hunk IDs (valid, unknown IDs,
 *   empty, more than 8, twice-claimed hunks); left-out hunks read as
 *   "other".
 * - The large-PR fallback (#107) assigns hunks whose IDs the reader
 *   never saw, or leaves them in "other" past the cap.
 * - The stored shape (snapshot `plotlines`, `HunkState.score/plotline`)
 *   and the filter's persistence (`PATCH diff-filter`).
 *
 * Fake `AgentRunner` throughout; no real agents, no real GitHub.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, Hunk, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

function hunkReply(summary: string, hidden: string | null, score: unknown): string {
  const pick = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : String(v));
  const s = score === undefined ? "" : `, "score": ${pick(score)}`;
  return `${summary}\n\n\`\`\`json\n{"hunk": {"summary": ${JSON.stringify(summary)}, "hiddenReason": ${hidden === null ? "null" : JSON.stringify(hidden)}${s}}}\n\`\`\`\n`;
}

/** Fake runner routing hunk-pass replies by the `[[h:…:hash]]` id in the prompt. */
class ScoreFakeRunner extends FakeAgentRunner {
  constructor(
    private byHash: Record<string, string>,
    scripts: { match: string; events: AgentEvent[] }[] = [],
  ) {
    super(scripts);
  }

  override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
    // Hunk prompts carry the `[[h:…:hash]]` id; the reader prompt quotes
    // the same ids in its diff text, so only route hunk prompts here.
    if (text.includes("# Hunk pass")) {
      for (const [hash, reply] of Object.entries(this.byHash)) {
        if (text.includes(`:${hash}]]`)) {
          this.prompts.push({ sessionId: session.id, text });
          yield* textEvents(reply);
          return;
        }
      }
    }
    yield* super.prompt(session, text);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function seedDb(ctx: Awaited<ReturnType<typeof createApp>>["ctx"], id: string): void {
  ctx.db
    .prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run("demo", "demo", "demo", "/tmp", Date.now());
  ctx.db
    .prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
  ctx.db
    .prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
    )
    .run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
}

function multiHunk(hash: string, start: number): Hunk {
  return {
    contentHash: hash,
    header: `@@ -${start},3 +${start},4 @@ some_function_name`,
    newStart: start,
    newEnd: start + 3,
    oldStart: start,
    oldEnd: start + 2,
    added: 2,
    removed: 1,
    lines: [
      { kind: "ctx", oldLine: start, newLine: start, text: "first = compute_alpha_value()" },
      { kind: "del", oldLine: start + 1, text: "second = compute_beta_value()" },
      { kind: "add", newLine: start + 1, text: "second = compute_gamma_value()" },
      { kind: "add", newLine: start + 2, text: "third = compute_delta_value()" },
      { kind: "ctx", oldLine: start + 2, newLine: start + 3, text: "fourth = compute_epsilon_value()" },
    ],
  };
}

function oneLineHunk(hash: string, start: number): Hunk {
  return {
    contentHash: hash,
    header: `@@ -${start},2 +${start},3 @@ some_function_name`,
    newStart: start,
    newEnd: start + 2,
    oldStart: start,
    oldEnd: start + 1,
    added: 1,
    removed: 0,
    lines: [
      { kind: "ctx", oldLine: start, newLine: start, text: "first = compute_alpha_value()" },
      { kind: "add", newLine: start + 1, text: "second = compute_gamma_value()" },
      { kind: "ctx", oldLine: start + 1, newLine: start + 2, text: "fourth = compute_epsilon_value()" },
    ],
  };
}

function smallSnapshot(id: string): ReviewSnapshot {
  return {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [
      { fileKey: "a-py", path: "a.py", category: "source", hunks: [multiHunk("hmulti", 10), oneLineHunk("hone", 30), multiHunk("hcited", 50), multiHunk("hother", 70)] },
    ],
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
    pipeline: {
      stages: { reader: "pending", base: "pending", critic: "pending", concepts: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
    },
  };
}

const SMALL_READER = `## The problem

Problem text [[h:a-py:hcited]].

## The central change

Central text.

\`\`\`json
{"cardIds": ["problem", "central"], "pendingCards": [], "concepts": [], "plotlines": [
  {"id": "thread-one", "name": "First thread", "description": "The main work.", "hunks": ["h:a-py:hmulti", "h:a-py:hcited", "h:nope:zzz"]},
  {"name": "Second thread", "description": "The rest.", "buildsOn": "thread-one", "hunks": ["h:a-py:hmulti", "h:a-py:hone"]}
]}
\`\`\`
`;

async function driveSmall(scripts: { match: string; events: AgentEvent[] }[], byHash: Record<string, string>, reader: string): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
  id: string;
}> {
  const agents = new ScoreFakeRunner(byHash, [
    { match: "# Reader task", events: textEvents(reader) },
    { match: "reply with exactly", events: textEvents("ready") },
    ...scripts,
  ]);
  const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
  const id = `rv_p169${Math.random().toString(36).slice(2, 8)}`;
  seedDb(ctx, id);
  ctx.reviews.putSnapshot(id, smallSnapshot(id));
  // Two phases: the first runs the reader (which lands plotlines); the
  // second runs the hunk pass the ingest-time fan-out would have started
  // (bypassed here by seeding the snapshot directly).
  await ctx.pipeline.resumeReview(id);
  await ctx.jobs.drain(30000);
  await ctx.pipeline.resumeReview(id);
  await ctx.jobs.drain(30000);
  return { app, ctx, id };
}

describe("hunk-pass scores + deterministic rules on top (#169)", () => {
  it("stores valid scores; invalid ones read as routine", async () => {
    const { app, ctx, id } = await driveSmall(
      [],
      {
        hmulti: hunkReply("Rewires the helper.", "import-only change", "substantive"),
        hone: hunkReply("Flips one call.", null, "mechanical"),
        hcited: hunkReply("Adds the call site.", "import-only change", "routine"),
        hother: hunkReply("Moves a block.", null, "hot"),
      },
      SMALL_READER,
    );
    try {
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.plotlines?.length ?? 0) === 2);
      const snap = ctx.reviews.getSnapshot(id)!;
      const scoreOf = (h: string): string | undefined =>
        snap.hunkStates.find((s) => s.contentHash === h)?.score;
      const hiddenOf = (h: string): string | undefined =>
        snap.files[0].hunks.find((hunk) => hunk.contentHash === h)?.hiddenReason;
      // Valid score stored; the deterministic hide reason still applies.
      expect(scoreOf("hmulti")).toBe("substantive");
      expect(hiddenOf("hmulti")).toBe("import-only change");
      // One-line change: never mechanical (and never hidden).
      expect(scoreOf("hone")).toBe("routine");
      expect(hiddenOf("hone")).toBeUndefined();
      // Guide-cited: never hidden; the score is kept as returned.
      expect(scoreOf("hcited")).toBe("routine");
      expect(hiddenOf("hcited")).toBeUndefined();
      // Invented level reads as routine.
      expect(scoreOf("hother")).toBe("routine");
    } finally {
      await app.close();
    }
  });

  it("stores routine when the reply carries no score", async () => {
    const { app, ctx, id } = await driveSmall(
      [],
      { hmulti: hunkReply("Rewires the helper.", null, undefined), hone: hunkReply("Flips one call.", null, undefined), hcited: hunkReply("Adds the call site.", null, undefined), hother: hunkReply("Moves a block.", null, undefined) },
      SMALL_READER,
    );
    try {
      await waitFor(() => snapHas(ctx, id, "hother"));
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.find((s) => s.contentHash === "hother")?.score).toBe("routine");
    } finally {
      await app.close();
    }
  });
});

function snapHas(ctx: Awaited<ReturnType<typeof createApp>>["ctx"], id: string, hash: string): boolean {
  return ctx.reviews.getSnapshot(id)?.hunkStates.some((s) => s.contentHash === hash && s.score !== undefined) === true;
}

describe("reader plotlines (#169)", () => {
  it("stores plotlines; unknown IDs dropped, first plotline wins, rest is other", async () => {
    const { app, ctx, id } = await driveSmall(
      [],
      {
        hmulti: hunkReply("Rewires the helper.", null, "substantive"),
        hone: hunkReply("Flips one call.", null, "routine"),
        hcited: hunkReply("Adds the call site.", null, "routine"),
        hother: hunkReply("Moves a block.", null, "routine"),
      },
      SMALL_READER,
    );
    try {
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.plotlines?.length ?? 0) === 2);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.plotlines).toMatchObject([
        { id: "thread-one", name: "First thread", description: "The main work." },
        { id: "second-thread", name: "Second thread", description: "The rest.", buildsOn: "thread-one" },
      ]);
      const plotOf = (h: string): string | undefined =>
        snap.hunkStates.find((s) => s.contentHash === h)?.plotline;
      // hmulti claimed twice: the first plotline wins.
      expect(plotOf("hmulti")).toBe("thread-one");
      expect(plotOf("hcited")).toBe("thread-one");
      expect(plotOf("hone")).toBe("second-thread");
      // Left out by the reader: other (nothing stored).
      expect(plotOf("hother")).toBeUndefined();
      // The reader saw every hunk ID here, so no assign step runs.
      expect(ctx.jobs.listByReview(id).filter((j) => j.kind === "plotline-assign")).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("reads a missing plotlines block as no plotlines", async () => {
    const reader = `## The problem

Problem text.

## The central change

Central text.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;
    const { app, ctx, id } = await driveSmall(
      [],
      { hmulti: hunkReply("Rewires the helper.", null, "routine"), hone: hunkReply("Flips one call.", null, "routine"), hcited: hunkReply("Adds the call site.", null, "routine"), hother: hunkReply("Moves a block.", null, "routine") },
      reader,
    );
    try {
      await waitFor(() => snapHas(ctx, id, "hother"));
      expect(ctx.reviews.getSnapshot(id)?.plotlines).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("caps more than 8 plotlines at 8", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `{"name": "Thread ${i}", "hunks": []}`).join(",\n");
    const reader = `## The problem

Problem text.

## The central change

Central text.

\`\`\`json
{"cardIds": ["problem", "central"], "plotlines": [${lines}]}
\`\`\`
`;
    const { app, ctx, id } = await driveSmall(
      [],
      { hmulti: hunkReply("Rewires the helper.", null, "routine"), hone: hunkReply("Flips one call.", null, "routine"), hcited: hunkReply("Adds the call site.", null, "routine"), hother: hunkReply("Moves a block.", null, "routine") },
      reader,
    );
    try {
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.plotlines?.length ?? 0) === 8);
      expect(ctx.reviews.getSnapshot(id)?.plotlines).toHaveLength(8);
    } finally {
      await app.close();
    }
  });
});

// --- large-PR fallback -------------------------------------------------------

/** One import-only hunk (deterministic hidden reason, like ingest assigns). */
function importHunk(hash: string, start: number): Hunk {
  return {
    contentHash: hash,
    header: `@@ -${start},4 +${start},5 @@ some_function_name`,
    newStart: start,
    newEnd: start + 4,
    oldStart: start,
    oldEnd: start + 3,
    added: 2,
    removed: 1,
    lines: [
      { kind: "ctx", oldLine: start, newLine: start, text: "first = compute_alpha_value()" },
      { kind: "del", oldLine: start + 1, text: "import beta_module" },
      { kind: "add", newLine: start + 1, text: "import gamma_module" },
      { kind: "add", newLine: start + 2, text: "import delta_module" },
      { kind: "ctx", oldLine: start + 2, newLine: start + 3, text: "fourth = compute_epsilon_value()" },
    ],
    hiddenReason: "imports",
  };
}

function normalHunk(hash: string, start: number): Hunk {
  return multiHunk(hash, start);
}

/**
 * Review sized so the reader lands on the no-uninteresting-hunks rung.
 * The import hunks carry long seeded summaries (the normal production
 * order: the ingest-time hunk pass lands before the reader). Those
 * summaries ride every per-hunk row of the richer rungs — the diff rows
 * and the hidden-hunk rows alike — so budget-limited overflows while
 * no-uninteresting-hunks (one line per import file, no hunk IDs) stays
 * small. The 150 import hunks are the fallback's candidates (under the
 * cap); 250 are past it.
 */
function bigSnapshot(id: string, normalFiles: number, importFiles: number): { snap: ReviewSnapshot; importIds: string[] } {
  const perFile = 25;
  const files: ReviewSnapshot["files"] = [];
  for (let f = 0; f < normalFiles; f++) {
    const hunks = [];
    for (let h = 0; h < perFile; h++) {
      hunks.push(normalHunk(`n${f}-${h}`, h * 10 + 1));
    }
    files.push({ fileKey: `m${f}`, path: `src/m${f}.py`, category: "source", hunks });
  }
  const importIds: string[] = [];
  const importStates: ReviewSnapshot["hunkStates"] = [];
  const filler = "Filler summary words. ".repeat(60);
  for (let f = 0; f < importFiles; f++) {
    const hunks = [];
    for (let h = 0; h < perFile; h++) {
      const hash = `i${f}-${h}`;
      importIds.push(`h:p${f}:${hash}`);
      hunks.push(importHunk(hash, h * 10 + 1));
      importStates.push({ contentHash: hash, folded: false, reviewed: false, summary: filler });
    }
    files.push({ fileKey: `p${f}`, path: `src/p${f}.py`, category: "source", hunks });
  }
  const snap: ReviewSnapshot = {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files,
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [],
    hunkStates: importStates,
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
    pipeline: {
      stages: { reader: "pending", base: "pending", critic: "pending", concepts: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
    },
  };
  return { snap, importIds };
}

function bigReader(firstIds: string[]): string {
  return `## The problem

Problem text.

## The central change

Central text.

\`\`\`json
{"cardIds": ["problem", "central"], "pendingCards": [], "concepts": [], "plotlines": [
  {"id": "bulk", "name": "Bulk work", "description": "The visible bulk.", "hunks": ${JSON.stringify(firstIds)}},
  {"id": "tail", "name": "Tail work", "description": "The rest.", "buildsOn": "bulk", "hunks": []}
]}
\`\`\`
`;
}

describe("large-PR plotline fallback (#169, #107)", () => {
  it("assigns hunks whose IDs the reader never saw", async () => {
    // 12 normal files × 25 + 6 import files × 25: bodies overflow the
    // inline budget and the seeded import summaries overflow
    // budget-limited, so the reader lands on the no-uninteresting-hunks
    // rung, where the 150 import hunks have no IDs.
    const { app, ctx, id, importIds } = await driveBigWith(12, 6);
    try {
      const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "plotline-assign");
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe("done");
      const snap = ctx.reviews.getSnapshot(id)!;
      // Every import hunk the assign step saw now carries the plotline…
      for (const hid of importIds) {
        const hash = hid.slice(hid.lastIndexOf(":") + 1);
        expect(snap.hunkStates.find((s) => s.contentHash === hash)?.plotline).toBe("tail");
      }
      // …but a hunk the reader already claimed keeps the reader's plotline.
      const readerClaimed = snap.files[0].hunks[0].contentHash;
      expect(snap.hunkStates.find((s) => s.contentHash === readerClaimed)?.plotline).toBe("bulk");
    } finally {
      await app.close();
    }
  }, 60000);

  it("leaves the rest in other past the assign cap", async () => {
    // 12 normal files × 25 + 10 import files × 25: 250 invisible hunks,
    // past the cap, so no assign step runs.
    const { app, ctx, id } = await driveBigWith(12, 10);
    try {
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.plotlines?.length ?? 0) === 2);
      expect(ctx.jobs.listByReview(id).filter((j) => j.kind === "plotline-assign")).toHaveLength(0);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.some((s) => s.plotline === "tail")).toBe(false);
    } finally {
      await app.close();
    }
  });
});

async function driveBigWith(
  normalFiles: number,
  importFiles: number,
): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
  id: string;
  importIds: string[];
}> {
  const id = `rv_big${Math.random().toString(36).slice(2, 8)}`;
  const { snap, importIds } = bigSnapshot(id, normalFiles, importFiles);
  // Replies pointed at this review's real hunk IDs: the reader claims two
  // visible hunks; the assign step covers every import hunk plus one the
  // reader already claimed (which must keep the reader's plotline).
  const firstIds = [0, 1].map((i) => `h:${snap.files[0].fileKey}:${snap.files[0].hunks[i].contentHash}`);
  const assignEntries: Record<string, string> = {};
  for (const hid of importIds) assignEntries[hid] = "tail";
  assignEntries[firstIds[0]] = "tail";
  const agents = new FakeAgentRunner([
    { match: "# Reader task", events: textEvents(bigReader(firstIds)) },
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Plotline assign", events: textEvents(`Only assignments below.\n\n\`\`\`json\n{"assignments": ${JSON.stringify(assignEntries)}}\n\`\`\`\n`) },
  ]);
  const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
  seedDb(ctx, id);
  ctx.reviews.putSnapshot(id, snap);
  // Two phases like driveSmall: reader (+ the plotline assign step) first,
  // then the hunk pass the ingest-time fan-out would have started.
  await ctx.pipeline.resumeReview(id);
  await ctx.jobs.drain(120000);
  await ctx.pipeline.resumeReview(id);
  await ctx.jobs.drain(120000);
  return { app, ctx, id, importIds };
}

// --- filter persistence ------------------------------------------------------

describe("diff-filter persistence (#169)", () => {
  it("remembers the filter with the review and refuses unknown values", async () => {
    const { app, ctx, id } = await driveSmall(
      [],
      { hmulti: hunkReply("Rewires the helper.", null, "substantive"), hone: hunkReply("Flips one call.", null, "routine"), hcited: hunkReply("Adds the call site.", null, "routine"), hother: hunkReply("Moves a block.", null, "routine") },
      SMALL_READER,
    );
    try {
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.plotlines?.length ?? 0) === 2);
      const patch = async (body: unknown): Promise<{ statusCode: number; json: () => unknown }> => {
        const res = await app.inject({
          method: "PATCH",
          url: `/api/reviews/${id}/diff-filter`,
          headers: authed,
          payload: body,
        } as never);
        return res as unknown as { statusCode: number; json: () => unknown };
      };
      let res = await patch({ plotline: "thread-one" });
      expect(res.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.diffFilter).toEqual({ plotline: "thread-one" });
      res = await patch({ score: "needs-attention" });
      expect(res.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.diffFilter).toEqual({ plotline: "thread-one", score: "needs-attention" });
      res = await patch({ plotline: "nope" });
      expect(res.statusCode).toBe(400);
      res = await patch({ score: "hot" });
      expect(res.statusCode).toBe(400);
      res = await patch({ plotline: null, score: null });
      expect(res.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.diffFilter).toBeUndefined();
      // The stored shape rides the snapshot API too.
      const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed } as never);
      expect(got.statusCode).toBe(200);
      const snap = got.json() as ReviewSnapshot;
      expect(Array.isArray(snap.plotlines)).toBe(true);
      expect(snap.hunkStates.find((s) => s.contentHash === "hmulti")?.score).toBe("substantive");
      expect(snap.hunkStates.find((s) => s.contentHash === "hmulti")?.plotline).toBe("thread-one");
    } finally {
      await app.close();
    }
  });
});
