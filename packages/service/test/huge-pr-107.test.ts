/**
 * Issue #107: huge PRs must not overflow the guide prompt, and the hunk
 * summarise pass must not fan out one job per hunk past a threshold.
 *
 * - Ladder: a synthetic snapshot generator (N files x M hunks, mixed
 *   categories) asserts rung selection, the hard cap at 3,000+ files,
 *   determinism, and guide-cited hunk survival.
 * - Hunk pass: under the threshold every hunk is enqueued as today; over
 *   it there is no fan-out, the stage still reaches done, on-demand
 *   `summarizeHunk` enqueues exactly one job, and a repeat dedupes.
 * - Errors: a provider "prompt is too long" failure is non-retryable.
 *
 * Fake `AgentRunner` throughout; no real agents, no real GitHub.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { isRetryableError } from "../src/agent/acp/errors.js";
import {
  buildBasePack,
  buildHunkSummaries,
  buildL1Source,
  buildLadder,
  charTokenEstimator,
  countCodePoints,
  DEFAULT_BASE_PROMPT_CAP_TOKENS,
  DEFAULT_LEFTOVER_FLOOR_TOKENS,
  type ContextHunk,
  type L1Rung,
  type PromptReviewSnapshot,
} from "../src/context/index.js";
import { createApp } from "../src/server.js";
import { buildUpdateVariables } from "../src/versions/update.js";

// --- synthetic snapshots -------------------------------------------------

const CATS = ["source", "generated", "docs", "config", "tests"] as const;

function testHunk(fileKey: string, index: number, category: string, marker: string): ContextHunk {
  const hidden =
    category === "generated"
      ? "generated"
      : category === "docs" || category === "config"
        ? "docs / config"
        : undefined;
  // Padded bodies (~20 lines each) so the ladder rungs are strictly
  // decreasing in size: header + summary rows must be much smaller than a
  // full hunk, the way real diffs are. (With tiny hunks the
  // budget-limited form can exceed the full text — today's behaviour too —
  // and the ladder simply skips to the first rung that fits.)
  const pad = Array.from({ length: 15 }, (_, i) => ({ kind: "ctx" as const, text: `pad ${marker} ${i} abcdefghij` }));
  return {
    contentHash: `hx-${fileKey}-${index}`,
    fileKey,
    header: `@@ -${index * 10 + 1},4 +${index * 10 + 1},5 @@ func${index}`,
    context: `func${index}`,
    newStart: index * 10 + 1,
    oldStart: index * 10 + 1,
    lines: [
      { kind: "ctx", text: `before ${marker}` },
      { kind: "del", text: `old ${marker}` },
      { kind: "add", text: `new ${marker}` },
      { kind: "add", text: `extra ${marker}` },
      ...pad,
      { kind: "ctx", text: `after ${marker}` },
    ],
    ...(hidden ? { hiddenReason: hidden } : {}),
  };
}

function testSnapshot(
  fileCount: number,
  hunksPerFile: number,
  opts: { cited?: Set<string>; summaries?: boolean } = {},
): PromptReviewSnapshot {
  const files = [];
  for (let f = 0; f < fileCount; f++) {
    const category = CATS[f % CATS.length];
    const dir = f % 3 === 0 ? "src" : f % 3 === 1 ? "test" : "docs";
    const ext = category === "docs" ? "md" : "py";
    const path = `${dir}/mod${f}.${ext}`;
    const fileKey = path.replace(/[^A-Za-z0-9_.-]/g, "-");
    const hunks = [];
    for (let h = 0; h < hunksPerFile; h++) {
      const hk = testHunk(fileKey, h, category, `${f}-${h}`);
      if (opts.cited?.has(`${fileKey}:hx-${fileKey}-${h}`)) hk.citedByGuide = true;
      if (opts.summaries) hk.summary = `Summary of ${path} hunk ${h}.`;
      hunks.push(hk);
    }
    files.push({ fileKey, path, category, hunks });
  }
  return {
    reviewId: "r-huge",
    title: "Huge PR",
    repo: "o/r",
    branch: "b",
    prNumber: 107,
    version: 1,
    headSha: "abc",
    baseRef: "main",
    guideRevision: "g1",
    model: "m",
    sourceKind: "pr",
    description: "Big change.",
    files,
    pinnedCode: [],
    cards: [],
    findings: [],
    concepts: [],
    existingComments: [],
    log: [],
  };
}

const RUNGS: L1Rung[] = ["full", "budget-limited", "no-uninteresting-hunks", "files-only", "counts-only"];

describe("L1 ladder (#107)", () => {
  it("stays on rung full under the budgets, with every hunk inlined", () => {
    const snap = testSnapshot(2, 1, { summaries: true });
    const l1 = buildL1Source(snap);
    expect(l1.rung).toBe("full");
    expect(l1.overBudget).toBe(false);
    expect(l1.inlinedHunkIds).toHaveLength(2);
    expect(l1.summarizedHunkIds).toHaveLength(0);
    expect(l1.text).toContain("new 0-0");
    expect(l1.text).toContain("## Hidden hunks");
  });

  it("degrades one rung at a time as the cap shrinks, every pick under its cap", () => {
    const snap = testSnapshot(30, 4, { summaries: true });
    const fullTokens = charTokenEstimator.estimateTokens(buildLadder(snap).text);
    const seen: L1Rung[] = [];
    let cap = fullTokens + 1;
    for (let i = 0; i < 40; i++) {
      const ladder = buildLadder(snap, { baseCapTokens: cap });
      const tokens = charTokenEstimator.estimateTokens(ladder.text);
      expect(tokens, `rung ${ladder.rung} at cap ${cap}`).toBeLessThanOrEqual(cap);
      if (seen[seen.length - 1] !== ladder.rung) seen.push(ladder.rung);
      if (ladder.rung === "counts-only") break;
      // Shrink past this rung's size so the next iteration must degrade.
      cap = Math.max(1, tokens - 1);
    }
    expect(seen[0]).toBe("full");
    expect(seen[seen.length - 1]).toBe("counts-only");
    // Monotonic degradation: rungs only move down the ladder.
    const idx = seen.map((r) => RUNGS.indexOf(r));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(seen)).toEqual(new Set(RUNGS));
  });

  it("stays under the cap at 3,000+ files with many thousands of hunks, deterministically", () => {
    // File 0 lands in src/ as source: key src-mod0.py (dots are kept in
    // file keys), marker "0-1".
    const citedFile = "src-mod0.py";
    const snap = testSnapshot(3100, 3, {
      summaries: true,
      cited: new Set([`${citedFile}:hx-${citedFile}-1`]),
    });
    const a = buildL1Source(snap);
    const b = buildL1Source(snap);
    expect(a.text).toBe(b.text);
    expect(charTokenEstimator.estimateTokens(a.text)).toBeLessThanOrEqual(DEFAULT_BASE_PROMPT_CAP_TOKENS);
    expect(["files-only", "counts-only", "no-uninteresting-hunks"]).toContain(a.rung);
    // The guide-cited hunk survives in full wherever it still fits.
    expect(a.text).toContain("new 0-1");
    expect(a.inlinedHunkIds).toContain(`h:${citedFile}:hx-${citedFile}-1`);
    // Past the full rung every output carries a notice naming real tools.
    expect(a.text).toContain("get_hunk");
    expect(a.text).toContain("search_review");
    expect(a.text).toContain("resolve");
    expect(a.text).toContain("get_code");
    expect(a.text).not.toContain("pin_context");
  });

  it("drops guide-cited hunks last, with a notice, when they alone exceed the cap", () => {
    const giant = Array.from({ length: 20000 }, (_, i) => ({ kind: "add" as const, text: `line ${i} pad pad pad pad` }));
    const snap = testSnapshot(1, 1);
    snap.files[0].hunks[0].lines = giant;
    snap.files[0].hunks[0].citedByGuide = true;
    const l1 = buildL1Source(snap);
    // files-only without the cited hunk is the first rung that fits: the
    // cited hunk is dropped last, with a notice saying so.
    expect(l1.rung).toBe("files-only");
    expect(l1.inlinedHunkIds).toHaveLength(0);
    expect(l1.text).toContain("were left out too");
    expect(charTokenEstimator.estimateTokens(l1.text)).toBeLessThanOrEqual(DEFAULT_BASE_PROMPT_CAP_TOKENS);
  });

  it("fails plainly, naming the PR size, when even counts-only cannot fit", () => {
    const snap = testSnapshot(2, 1);
    expect(() => buildL1Source(snap, { baseCapTokens: 10 })).toThrow(
      /Review too large for a guide prompt: PR #107 2 files, 2 hunks/,
    );
  });

  it("caps the hunk-summaries section: cited rows survive, the rest become counts", () => {
    const citedFile = "src-mod0.py";
    const snap = testSnapshot(3000, 3, {
      summaries: true,
      cited: new Set([`${citedFile}:hx-${citedFile}-0`]),
    });
    const a = buildHunkSummaries(snap);
    const b = buildHunkSummaries(snap);
    expect(a).toBe(b);
    expect(charTokenEstimator.estimateTokens(a)).toBeLessThanOrEqual(DEFAULT_BASE_PROMPT_CAP_TOKENS);
    expect(a).toContain(`Summary of src/mod0.py hunk 0.`);
    expect(a).toContain("- hunks: 9000 (9000 with summaries)");
    expect(a).toContain("get_hunk");
  });
});

// --- hunk pass -------------------------------------------------------------

async function demoApp(agents: FakeAgentRunner): Promise<ReturnType<typeof createApp>> {
  return createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
}

function hunkReply(summary: string): string {
  return `${summary}\n\n\`\`\`json\n{"hunk": {"summary": ${JSON.stringify(summary)}, "hiddenReason": null}}\n\`\`\`\n`;
}

/** Review snapshot with `total` two-line hunks; `cited` hashes get a guide citation. */
async function makeBigReview(
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  total: number,
  cited: string[] = [],
): Promise<{ id: string; hashes: string[] }> {
  const id = `rv_h107${Math.random().toString(36).slice(2, 8)}`;
  ctx.db
    .prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
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
  const hashes: string[] = [];
  const files: ReviewFile[] = [];
  const perFile = 25;
  for (let f = 0; f * perFile < total; f++) {
    const hunks: ReviewFile["hunks"] = [];
    for (let h = 0; h < perFile && f * perFile + h < total; h++) {
      const n = f * perFile + h;
      const hash = `hx${n}`;
      hashes.push(hash);
      hunks.push({
        contentHash: hash,
        header: `@@ -${n * 10 + 1},2 +${n * 10 + 1},3 @@`,
        newStart: n * 10 + 1,
        newEnd: n * 10 + 3,
        oldStart: n * 10 + 1,
        oldEnd: n * 10 + 2,
        added: 1,
        removed: 0,
        lines: [
          { kind: "ctx", oldLine: n * 10 + 1, newLine: n * 10 + 1, text: `x${n} = 1` },
          { kind: "add", newLine: n * 10 + 2, text: `y${n} = 2` },
          { kind: "ctx", oldLine: n * 10 + 2, newLine: n * 10 + 3, text: `z${n} = 3` },
        ],
      });
    }
    files.push({ fileKey: `f${f}`, path: `src/f${f}.py`, category: "source" as const, hunks });
  }
  const byHash = new Map<string, { fileKey: string; start: number; end: number }>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      byHash.set(hunk.contentHash, { fileKey: file.fileKey, start: hunk.newStart, end: hunk.newEnd });
    }
  }
  const snap: ReviewSnapshot = {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files,
    ingest: { status: "ready" },
    pages: [
      {
        id: "root",
        kind: "root",
        title: "Guide",
        cards: cited.map((hash, i) => {
          const loc = byHash.get(hash)!;
          const target = `h:${loc.fileKey}:${hash}`;
          return {
            id: `c${i}`,
            pageId: "root",
            title: `Card ${i}`,
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [
              {
                type: "paragraph",
                id: `b${i}`,
                text: { standard: `See [[${target}]]` },
                citations: [{ target }],
              },
            ],
            undoStack: [],
          };
        }),
      },
    ],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    pipeline: {
      stages: {
        reader: "done",
        base: "done",
        critic: "done",
        "hunk-pass": "pending",
        "go-deeper": "pending",
      },
    },
  };
  ctx.reviews.putSnapshot(id, snap);
  return { id, hashes };
}

async function waitForStage(
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  id: string,
  want: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (ctx.reviews.getSnapshot(id)?.pipeline?.stages["hunk-pass"] === want) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForStage: hunk-pass never reached ${want}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("top-N auto hunk summaries (#376)", () => {
  /** Hashes back out of hunk-pass job dedupe anchors (`hunk:<hash>|…`). */
  function hunkJobHashes(
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    id: string,
  ): string[] {
    return ctx.jobs
      .listByReview(id)
      .filter((j) => j.kind === "hunk-pass")
      .map((j) => (j.dedupeKey?.split("|", 1)[0] ?? "").replace(/^hunk:/, ""));
  }

  async function setStages(
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    id: string,
    stages: Record<string, string>,
  ): Promise<void> {
    await ctx.reviews.mutate(id, (draft) => {
      draft.pipeline = { stages: { reader: "pending", base: "pending", critic: "pending", "hunk-pass": "pending", "go-deeper": "pending", ...stages } };
    });
  }

  async function citeHashes(
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    id: string,
    hashes: string[],
  ): Promise<void> {
    const snap = ctx.reviews.getSnapshot(id)!;
    const byHash = new Map<string, { fileKey: string }>();
    for (const file of snap.files) {
      for (const hunk of file.hunks) byHash.set(hunk.contentHash, { fileKey: file.fileKey });
    }
    await ctx.reviews.mutate(id, (draft) => {
      draft.pages = [
        {
          id: "root",
          kind: "root",
          title: "Guide",
          cards: hashes.map((hash, i) => ({
            id: `c${i}`,
            pageId: "root",
            title: `Card ${i}`,
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [
              {
                type: "paragraph",
                id: `b${i}`,
                text: { standard: `See [[h:${byHash.get(hash)?.fileKey}:${hash}]]` },
                citations: [{ target: `h:${byHash.get(hash)?.fileKey}:${hash}` }],
              },
            ],
            undoStack: [],
          })),
        },
      ];
    });
  }

  /** Mixed-category review; hashes are `mx0…` in file/hunk order. */
  async function makeMixedReview(
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    files: { path: string; category: ReviewFile["category"]; hidden?: boolean }[],
  ): Promise<{ id: string; hashes: string[] }> {
    const id = `rv_h376${Math.random().toString(36).slice(2, 8)}`;
    ctx.db
      .prepare(
        "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
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
    const hashes: string[] = [];
    const reviewFiles: ReviewFile[] = files.map((spec) => {
      const fileKey = spec.path.replace(/[^A-Za-z0-9_.-]/g, "-");
      const n = hashes.length;
      const hash = `mx${n}`;
      hashes.push(hash);
      return {
        fileKey,
        path: spec.path,
        category: spec.category,
        hunks: [
          {
            contentHash: hash,
            header: `@@ -${n * 10 + 1},2 +${n * 10 + 1},4 @@`,
            newStart: n * 10 + 1,
            newEnd: n * 10 + 4,
            oldStart: n * 10 + 1,
            oldEnd: n * 10 + 3,
            added: 2,
            removed: 1,
            lines: [
              { kind: "ctx", oldLine: n * 10 + 1, newLine: n * 10 + 1, text: `x${n} = 1` },
              { kind: "del", oldLine: n * 10 + 2, text: `y${n} = 2` },
              { kind: "add", newLine: n * 10 + 2, text: `z${n} = 3` },
              { kind: "add", newLine: n * 10 + 3, text: `w${n} = 4` },
            ],
            ...(spec.hidden ? { hiddenReason: "imports" } : {}),
          },
        ],
      };
    });
    const snap: ReviewSnapshot = {
      review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
      version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
      files: reviewFiles,
      ingest: { status: "ready" },
      pages: [],
      annotations: [],
      hunkStates: [],
      fileStates: [],
      viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
      pipeline: {
        stages: {
          reader: "done",
          base: "done",
          critic: "done",
          "hunk-pass": "pending",
          "go-deeper": "pending",
        },
      },
    };
    ctx.reviews.putSnapshot(id, snap);
    return { id, hashes };
  }

  it("ingest enqueues at most N in category order, skipping generated", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: hunkReplyEvents() }]);
    const { app, ctx } = await demoApp(agents);
    try {
      ctx.settings.update({ hunkSummaryLimit: 3 });
      const { id } = await makeMixedReview(ctx, [
        { path: "docs/d.md", category: "docs" },
        { path: "docs/e.md", category: "docs" },
        { path: "src/s.py", category: "source" },
        { path: "src/t.py", category: "source" },
        { path: "test/u.py", category: "tests" },
        { path: "gen/g.py", category: "generated" },
        { path: "gen/h.py", category: "generated" },
      ]);
      // mx0-1 docs, mx2-3 source, mx4 tests, mx5-6 generated.
      await ctx.pipeline.resumeReview(id);
      expect(hunkJobHashes(ctx, id)).toEqual(["mx2", "mx3", "mx4"]);
    } finally {
      await app.close();
    }
  });

  it("hidden and generated hunks are never auto-summarised", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: hunkReplyEvents() }]);
    const { app, ctx } = await demoApp(agents);
    try {
      ctx.settings.update({ hunkSummaryLimit: 50 });
      const { id, hashes } = await makeMixedReview(ctx, [
        { path: "src/hidden.py", category: "source", hidden: true },
        { path: "src/visible.py", category: "source" },
        { path: "gen/g.py", category: "generated" },
      ]);
      await ctx.pipeline.resumeReview(id);
      expect(hunkJobHashes(ctx, id)).toEqual([hashes[1]]);
    } finally {
      await app.close();
    }
  });

  it("at 0 no auto summaries run and the stage still reaches done", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: hunkReplyEvents() }]);
    const { app, ctx } = await demoApp(agents);
    try {
      ctx.settings.update({ hunkSummaryLimit: 0 });
      const { id } = await makeBigReview(ctx, 3);
      const res = await ctx.pipeline.resumeReview(id);
      expect(res.jobIds).toHaveLength(0);
      expect(hunkJobHashes(ctx, id)).toHaveLength(0);
      await waitForStage(ctx, id, "done");
    } finally {
      await app.close();
    }
  });

  it("guide-cited hunks get priority within N after the reader, never beyond it", async () => {
    const agents = new FakeAgentRunner([
      { match: "Hunk pass", events: hunkReplyEvents() },
      {
        match: "# Critic task",
        events: [
          { type: "text", delta: `No findings.\n\n\`\`\`json\n{"findings": []}\n\`\`\`\n` },
          { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    // Cap 1 plus a gate on the hunk turns: the first hunk job stays
    // running while the second stays queued, so the re-prioritisation is
    // deterministic.
    let releaseHunk!: () => void;
    const hunkGate = new Promise<void>((r) => {
      releaseHunk = r;
    });
    let hunkGated = true;
    const origPrompt = agents.prompt.bind(agents);
    agents.prompt = async function* (session, text, signal) {
      if (hunkGated && text.includes("Hunk pass")) await hunkGate;
      yield* origPrompt(session, text, signal);
    };
    const { app, ctx } = await demoApp(agents);
    try {
      ctx.settings.update({ hunkSummaryLimit: 2, sessionsPerProvider: 1 });
      const { id } = await makeBigReview(ctx, 3, ["hx2"]);
      // Reader landed, base still open: the after-reader path runs.
      await setStages(ctx, id, { reader: "done", base: "pending", critic: "done", "hunk-pass": "pending", "go-deeper": "done" });
      await ctx.pipeline.resumeReview(id);
      // The diff-last cited hunk wins the budget over the first two.
      expect(hunkJobHashes(ctx, id)).toEqual(["hx2"]);
      // Newly cited hx0 takes the last budget slot; hx1 stays on demand.
      await citeHashes(ctx, id, ["hx0"]);
      await setStages(ctx, id, { reader: "done", base: "pending", critic: "done", "hunk-pass": "pending", "go-deeper": "done" });
      await ctx.pipeline.resumeReview(id);
      expect(hunkJobHashes(ctx, id)).toEqual(["hx2", "hx0"]);
      // Budget exhausted: nothing new enqueues, but the still-queued cited
      // job is raised ahead of the background band (the running one keeps
      // its band).
      await setStages(ctx, id, { reader: "done", base: "pending", critic: "done", "hunk-pass": "pending", "go-deeper": "done" });
      await ctx.pipeline.resumeReview(id);
      expect(hunkJobHashes(ctx, id)).toEqual(["hx2", "hx0"]);
      const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "hunk-pass");
      const ofHash = (hash: string) =>
        jobs.find((j) => (j.dedupeKey?.split("|", 1)[0] ?? "") === `hunk:${hash}`);
      expect(ofHash("hx2")?.state).toBe("running");
      expect(ofHash("hx0")?.state).toBe("queued");
      expect(ofHash("hx0")?.priority).toBe(JOB_PRIORITY.visible);
      expect(ofHash("hx2")?.priority).toBe(JOB_PRIORITY.background);
      hunkGated = false;
      releaseHunk();
      await ctx.jobs.drain(10000);
      await waitForStage(ctx, id, "done");
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.find((s) => s.contentHash === "hx2")?.summary).toBe("Adds one row.");
      expect(snap.hunkStates.find((s) => s.contentHash === "hx0")?.summary).toBe("Adds one row.");
      expect(snap.hunkStates.find((s) => s.contentHash === "hx1")).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("summarizeMore queues the next N in order, skipping hidden hunks", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: hunkReplyEvents() }]);
    const { app, ctx } = await demoApp(agents);
    try {
      ctx.settings.update({ hunkSummaryLimit: 2 });
      const { id, hashes } = await makeMixedReview(ctx, [
        { path: "src/a.py", category: "source" },
        { path: "src/b.py", category: "source" },
        { path: "src/h.py", category: "source", hidden: true },
        { path: "docs/d.md", category: "docs" },
      ]);
      await ctx.pipeline.resumeReview(id);
      expect(hunkJobHashes(ctx, id)).toEqual([hashes[0], hashes[1]]);
      await ctx.jobs.drain(10000);
      await waitForStage(ctx, id, "done");
      // First batch landed; the next batch continues past it and never
      // touches the hidden hunk.
      const jobs = await ctx.pipeline.summarizeMore(id);
      expect(jobs.map((j) => (j.dedupeKey?.split("|", 1)[0] ?? "").replace(/^hunk:/, ""))).toEqual([hashes[3]]);
      await ctx.jobs.drain(10000);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.find((s) => s.contentHash === hashes[3])?.summary).toBe("Adds one row.");
      expect(snap.hunkStates.find((s) => s.contentHash === hashes[2])).toBeUndefined();
      // The route answers 202 with the batch's job ids.
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/hunks/summarize-more`,
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(202);
      expect((res.json() as { jobIds: string[] }).jobIds).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("an on-demand request still enqueues exactly one job and a repeat dedupes", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: hunkReplyEvents() }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const { id, hashes } = await makeBigReview(ctx, 10);
      const first = await ctx.pipeline.summarizeHunk(id, hashes[7]);
      const second = await ctx.pipeline.summarizeHunk(id, hashes[7]);
      if (!("id" in first) || !("id" in second)) throw new Error("expected jobs, got reused summaries");
      expect(first.id).toBe(second.id);
      const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "summarize");
      expect(jobs).toHaveLength(1);
      await ctx.jobs.drain(10000);
      expect(ctx.reviews.getSnapshot(id)!.hunkStates.find((s) => s.contentHash === hashes[7])?.summary).toBe(
        "Adds one row.",
      );
    } finally {
      await app.close();
    }
  });
});

function hunkReplyEvents(): AgentEvent[] {
  return [
    { type: "text", delta: hunkReply("Adds one row.") },
    { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
    { type: "done", stopReason: "end_turn" },
  ];
}

describe("code-point counting without allocation (#107)", () => {
  it("matches spread counting, including astral characters", () => {
    const cases = [
      "",
      "abcd",
      "abcde",
      // Astral emoji: one code point, two UTF-16 units.
      "a\uD83D\uDE00b",
      "\uD83D\uDE00\uD83D\uDE01x",
      // Combining mark: two code points, never merged.
      "e\u0301",
      // Lone lead / trail surrogates: one code point each, like spread.
      "a\uD800b",
      "a\uDC00b",
      "\uD800",
      "\uDC00",
      "x\uD800",
      "\uD800x\uDC00y",
    ];
    for (const text of cases) {
      expect(countCodePoints(text)).toBe([...text].length);
      expect(charTokenEstimator.estimateTokens(text)).toBe(
        text === "" ? 0 : Math.max(1, Math.ceil([...text].length / 4)),
      );
    }
  });
});

describe("provider prompt-too-long errors (#107)", () => {  it("is non-retryable so the queue does not loop", () => {
    expect(isRetryableError(new Error("Internal error: Prompt is too long"))).toBe(false);
    expect(isRetryableError(new Error("Prompt is too long"))).toBe(false);
    // Sanity: genuinely transient errors still retry.
    expect(isRetryableError(new Error("rate limit, try again later"))).toBe(true);
  });
});

describe("assembled base message cap (#107)", () => {
  it("stays under the cap for a 3,000-file snapshot, summaries on leftovers", () => {
    const snap = testSnapshot(3000, 3, { summaries: true });
    const a = buildBasePack(snap, "L0 instructions");
    const b = buildBasePack(snap, "L0 instructions");
    expect(a.user).toBe(b.user);
    expect(a.hunkSummaries).toBe(b.hunkSummaries);
    const userTokens = charTokenEstimator.estimateTokens(a.user);
    const summariesTokens = charTokenEstimator.estimateTokens(a.hunkSummaries);
    // L1 plus the small L1b/L2 layers stays under the cap on its own…
    expect(userTokens).toBeLessThanOrEqual(DEFAULT_BASE_PROMPT_CAP_TOKENS);
    // …and the template-shaped assembly (user + summaries variable)
    // stays within the cap plus the leftovers floor.
    expect(userTokens + summariesTokens).toBeLessThanOrEqual(
      DEFAULT_BASE_PROMPT_CAP_TOKENS + DEFAULT_LEFTOVER_FLOOR_TOKENS,
    );
    // Summaries degrade to counts + notice instead of overflowing.
    expect(a.hunkSummaries).toContain("- hunks: 9000 (9000 with summaries)");
    expect(a.hunkSummaries).toContain("get_hunk");
  });

  it("leaves small reviews byte-identical (summaries in full)", () => {
    const snap = testSnapshot(2, 1, { summaries: true });
    const pack = buildBasePack(snap, "L0 instructions");
    expect(pack.hunkSummaries).toContain("Summary of src/mod0.py hunk 0.");
    expect(pack.hunkSummaries).not.toContain("left out to fit");
  });
});

describe("update-pass changed hunks cap (#107)", () => {
  it("truncates thousands of changed hunks with a notice instead of overflowing", async () => {
    const agents = new FakeAgentRunner([]);
    const { app, ctx } = await demoApp(agents);
    try {
      const total = 1200;
      const { id, hashes } = await makeBigReview(ctx, total);
      const snap = ctx.reviews.getSnapshot(id)!;
      await ctx.reviews.mutate(id, (draft) => {
        draft.versionStatus = {
          stale: true,
          fromVersion: 1,
          toVersion: 2,
          unchangedHunks: 0,
          changedHunks: total,
          newHunks: 0,
          removedHunks: 0,
          renamedFiles: [],
          changedOldIds: [],
          // hunk n lives in file floor(n/25): the `h:` id must match.
          changedNewIds: hashes.map((h) => {
            const n = Number(h.slice(2));
            return `h:f${Math.floor(n / 25)}:${h}`;
          }),
          rangeDiff: "",
          fetchedAt: Date.now(),
        };
      });
      const vars = buildUpdateVariables(ctx.reviews.getSnapshot(id) ?? snap, { capTokens: 3000 });
      expect(charTokenEstimator.estimateTokens(vars.changed_hunks)).toBeLessThanOrEqual(3000);
      expect(vars.changed_hunks).toContain("omitted to fit");
      expect(vars.changed_hunks).toContain("get_hunk");
      // Under the default cap the same 1,200 hunks fit whole: no notice.
      const whole = buildUpdateVariables(ctx.reviews.getSnapshot(id) ?? snap);
      expect(whole.changed_hunks).not.toContain("omitted to fit");
      expect(whole.changed_hunks).toContain("h:f47:hx1199");
      // The assembled variables stay under the cap together.
      const totalVars =
        charTokenEstimator.estimateTokens(whole.changed_hunks) +
        charTokenEstimator.estimateTokens(whole.stale_cards) +
        charTokenEstimator.estimateTokens(whole.findings);
      expect(totalVars).toBeLessThanOrEqual(DEFAULT_BASE_PROMPT_CAP_TOKENS);
    } finally {
      await app.close();
    }
  });
});
