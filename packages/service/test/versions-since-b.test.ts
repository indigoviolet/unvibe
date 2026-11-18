/**
 * Since-B step 1 (issue #351) as Explain does it (issue #413): an
 * existing review gains commits, and Explain writes the Changes-since-X
 * section while the old guide stays byte-for-byte.
 *
 * - Refresh defaults X to the version last opened and computes the
 *   X..head hunk set by hunk-content comparison (rebase-proof).
 * - Explain writes the section with a feedback link; the old card text
 *   is unchanged and no addendum is appended.
 * - A feedback link ties the change to the review comment it answers
 *   (matched by file, line and time); unrelated and out-of-window
 *   remarks stay out of the prompt.
 * - No plotline placement, no new plotlines, no stale markers.
 * - The `since-baseline` record route; the Since diff filter flag.
 * - A rebased-X case: content comparison, not ancestry.
 *
 * Fake runner + stub `gh` only (branch reviews make no gh calls at all);
 * made-up fixtures, no live spend.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileKeyForPath,
  hunkChangedSinceB,
  isSinceBaseline,
  type ExplainPassResult,
  type ReviewSnapshot,
} from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { JobQueue } from "../src/jobs/index.js";
import { createApp } from "../src/server.js";
import { computeSinceHunks, formatSinceContext, matchSinceFeedback, resolveSinceBaseline } from "../src/versions/since.js";
import { buildExplainVariables, JsonBlockReplyParser } from "../src/versions/explain.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

const V1 = ["def alpha():", "    return 1", "", "", "CONST_A = 10", "", "", "def beta():", "    return 2", ""].join("\n");
const V2 = ["def alpha():", "    return 11", "", "", "CONST_A = 10", "", "", "def beta():", "    return 2", "", "", "def gamma():", "    return 3", ""].join(
  "\n",
);

async function waitReady(
  inject: (opts: { method: string; url: string; headers?: Record<string, string> }) => Promise<{ statusCode: number; json(): unknown }>,
  id: string,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  for (;;) {
    const got = await inject({ method: "GET", url: `/api/reviews/${id}` });
    if (got.statusCode === 200) {
      const snap = got.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    if (Date.now() - start > 15000) throw new Error("ingest did not finish");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function fakeReply(snap: ReviewSnapshot): string {
  const changed = snap.sinceHunks?.changed ?? [];
  const added = snap.sinceHunks?.added ?? [];
  const target = changed[0] ?? added[0] ?? "h:missing:none";
  const commitSha = snap.commits?.find((c) => /rework/i.test(c.subject))?.sha ?? snap.commits?.[0]?.sha ?? "deadbee";
  const baselineVersion = snap.sinceBaseline?.kind === "version" ? snap.sinceBaseline.version : 1;
  const result: ExplainPassResult = {
    baseline: { kind: "version", version: baselineVersion },
    sinceHunks: { added: [...added], changed: [...changed] },
    sinceSection: {
      cards: [{
        id: "since-delta-1",
        pageId: "since",
        title: "Alpha reworked, gamma added",
        collapsed: false,
        revision: 1,
        undoStack: [],
        blocks: [{
          type: "paragraph",
          id: "b-since-1",
          text: "Alpha now returns 11 and gamma is new, answering the review comment.",
          citations: [{ target }],
        }],
        // Agent-shaped `{ kind, id }` pointers: the JSON text goes
        // through the real parser, which carries them as answerRefs.
        answers: [
          { kind: "comment", id: "7" },
          { kind: "thread", id: "t-1" },
          { kind: "conversation", id: "3" },
          { kind: "commit", id: commitSha },
          { kind: "comment", id: "999" },
        ] as unknown as import("@unvibe/shared").SinceFeedbackLink[],
      }],
    },
  };
  return `Explained the delta.\n\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n`;
}

describe("since-B step 1", () => {
  it("refresh defaults X, explain writes the section with a feedback link and leaves the old guide alone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-351-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), `${V1}\n`);
    await git(dir, "commit", "-am", "feature work");

    const queue = new JobQueue();
    const seenPrompts: string[] = [];
    const baseRunner = {
      runExplainPrompt: async (prompt: string) => {
        seenPrompts.push(prompt);
        const live = (globalThis as { __snap351?: ReviewSnapshot }).__snap351;
        if (!live) throw new Error("no snapshot for fake reply");
        return fakeReply(live);
      },
    };
    const { app, ctx } = await createApp("tok", { runner: real, jobs: queue, baseRunner, autoPipeline: false });
    try {
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const allRepos = (added.json() as { repos: { id: string; localPath?: string }[] }).repos;
      const repoId = allRepos.find((r) => (r.localPath ?? "").includes("unvibe-351-"))!.id;
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch: "feature" } });
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitReady((o) => app.inject({ ...o, headers: authed }), id);

      // Seed a guide card citing the v1 hunk, plus one plotline owning it.
      await ctx.reviews.mutate(id, (draft) => {
        const h = draft.files[0].hunks[0];
        const hk = `h:${draft.files[0].fileKey}:${h.contentHash}`;
        draft.plotlines = [{ id: "core", name: "Core", description: "The core change." }];
        draft.hunkStates.push({ contentHash: h.contentHash, folded: false, reviewed: true, plotline: "core" });
        draft.pages.push({
          id: "p-root",
          kind: "root",
          title: "Guide",
          cards: [{
            id: "c-a",
            pageId: "p-root",
            title: "Alpha",
            collapsed: false,
            revision: 1,
            undoStack: [],
            blocks: [{ type: "paragraph", id: "b1", text: "old prose", citations: [{ target: hk }] }],
          }],
        });
      });

      // v2: rework alpha, add gamma.
      fs.writeFileSync(path.join(dir, "a.py"), `${V2}\n`);
      await git(dir, "commit", "-am", "rework alpha\n\nThe reviewer asked for 11, not 1.");
      const refreshed = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(refreshed.statusCode).toBe(200);

      let snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.review.currentVersion).toBe(2);
      // B defaults to the version last opened.
      expect(snap.sinceBaseline).toEqual({ kind: "version", version: 1 });
      expect(isSinceBaseline(snap.sinceBaseline)).toBe(true);
      expect(resolveSinceBaseline(snap)).toEqual({ kind: "version", version: 1 });
      // The B..head set matches the refresh's latest-version set here.
      const statusIds = new Set(snap.versionStatus?.changedNewIds ?? []);
      for (const hid of [...(snap.sinceHunks?.added ?? []), ...(snap.sinceHunks?.changed ?? [])]) {
        expect(statusIds.has(hid)).toBe(true);
      }
      expect((snap.sinceHunks?.added.length ?? 0) + (snap.sinceHunks?.changed.length ?? 0)).toBeGreaterThan(0);

      // Feedback fixtures: one matching review comment (file+line+time),
      // one on an untouched path, one out-of-window, one conversation
      // remark, and one local thread on a since hunk.
      const v1At = snap.review.versions.find((v) => v.n === 1)!.fetchedAt;
      const v2At = snap.review.versions.find((v) => v.n === 2)!.fetchedAt;
      const mid = new Date(Math.floor((v1At + v2At) / 2)).toISOString();
      const before = new Date(v1At - 60_000).toISOString();
      const changedFile = snap.files.find((f) => f.path === "a.py")!;
      const changedHunk = changedFile.hunks[0];
      const changedId = `h:${changedFile.fileKey}:${changedHunk.contentHash}`;
      const line = changedHunk.newStart;
      await ctx.reviews.mutate(id, (draft) => {
        draft.existingComments = [
          { id: 7, path: "a.py", line, body: "Should return 11 here.", bodyHtml: "Should return 11 here.", author: "reviewer", createdAt: mid, htmlUrl: "https://example.test/pr/1#issuecomment-7" },
          { id: 8, path: "other.py", line: 1, body: "Unrelated note.", bodyHtml: "Unrelated note.", createdAt: mid },
          { id: 9, path: "a.py", line, body: "Ancient note.", bodyHtml: "Ancient note.", createdAt: before },
        ];
        draft.prConversation = [{ id: 3, author: "reviewer", body: "Please rework alpha.", createdAt: mid, htmlUrl: "https://example.test/pr/1#issue-3" }];
        draft.annotations.push({
          id: "t-1",
          type: "thread",
          anchor: {
            host: { kind: "diff-line", fileKey: changedFile.fileKey, line },
            quotedText: "return 11",
            prefix: "",
            suffix: "",
            position: line,
            version: 2,
          },
          replies: [{
            id: "ans_thread1", seq: 1,
            kind: "comment",
            who: "you",
            question: null,
            blocks: [{ type: "paragraph", id: "b-t1", text: "Agreed, fix alpha.", citations: [] }],
            revision: 1,
            undoStack: [],
          }],
          open: true,
          pinned: true,
          post: false,
        });
      });
      snap = ctx.reviews.getSnapshot(id)!;
      const ctx2 = formatSinceContext(snap, snap.sinceHunks!);
      // Commit message explains why; matching comment + thread + remark link in.
      expect(ctx2).toContain("rework alpha");
      expect(ctx2).toContain("Should return 11 here.");
      expect(ctx2).toContain("Agreed, fix alpha.");
      expect(ctx2).toContain("Please rework alpha.");
      expect(ctx2).toContain(changedId);
      // Unrelated path and out-of-window remarks stay out.
      expect(ctx2).not.toContain("Unrelated note.");
      expect(ctx2).not.toContain("Ancient note.");
      const fb = matchSinceFeedback(snap, snap.sinceHunks!);
      expect(fb.comments.map((c) => c.comment.id)).toEqual([7]);
      expect(fb.conversation.map((c) => c.id)).toEqual([3]);

      // The baseline picker rejects the head and unknown versions.
      const badHead = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { version: 2 } });
      expect(badHead.statusCode).toBe(400);
      const badHigh = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { version: 99 } });
      expect(badHigh.statusCode).toBe(400);

      // Run the explain pass on the fake runner.
      (globalThis as { __snap351?: ReviewSnapshot }).__snap351 = ctx.reviews.getSnapshot(id) ?? undefined;
      const enq = await app.inject({ method: "POST", url: `/api/reviews/${id}/explain`, headers: authed });
      expect(enq.statusCode).toBe(202);
      await queue.drain(5000);
      const jobId = (enq.json() as { jobId: string }).jobId;
      expect(queue.get(jobId)?.state).toBe("done");
      expect(seenPrompts).toHaveLength(1);
      expect(seenPrompts[0]).toContain("## Baseline");
      expect(seenPrompts[0]).not.toContain("append");
      expect(seenPrompts[0]).toContain("[comment 7]");
      expect(seenPrompts[0]).toContain("[thread t-1]");
      expect(seenPrompts[0]).toContain("[conversation 3]");

      const after = ctx.reviews.getSnapshot(id)!;
      // The Changes-since-X section, with its cards cited into the new hunks.
      expect(after.sinceSection?.baseline).toEqual({ kind: "version", version: 1 });
      expect(after.sinceSection?.headVersion).toBe(2);
      expect(after.sinceSection?.cards).toHaveLength(1);
      const sc = after.sinceSection!.cards[0];
      expect(sc.title).toContain("Alpha");
      const cites = sc.blocks.flatMap((b) => ("citations" in b ? b.citations : []));
      expect(cites.some((c) => c.target === changedId || (after.sinceHunks?.added ?? []).includes(c.target))).toBe(true);
      // Untouched, not rewritten: the old card text is byte-for-byte, with no addendum.
      const card = after.pages.flatMap((p) => p.cards).find((c) => c.id === "c-a")!;
      expect(card.blocks).toHaveLength(1);
      expect(card.blocks[0].type).toBe("paragraph");
      if (card.blocks[0].type !== "paragraph") throw new Error("unexpected block");
      expect(card.blocks[0].text).toBe("old prose");
      expect("addenda" in card).toBe(false);
      // The Changes-since-X card's pointers resolve; unknown id 999 is dropped.
      expect(sc.answers).toHaveLength(4);
      const byKind = Object.fromEntries(sc.answers!.map((a) => [a.kind, a]));
      expect(byKind["comment"].label).toContain("@reviewer on a.py:");
      expect(byKind["comment"].excerpt).toContain("Should return 11 here.");
      expect(byKind["thread"]).toMatchObject({ label: "Thread t-1", url: "#t-1" });
      expect(byKind["thread"].excerpt).toContain("Agreed, fix alpha.");
      expect(byKind["conversation"].url).toBe("https://example.test/pr/1#issue-3");
      expect(byKind["commit"].label).toContain("rework alpha");
      // No plotline placement: no new plotlines, assignments untouched.
      const plotIds = new Set((after.plotlines ?? []).map((p) => p.id));
      expect(plotIds.has("core")).toBe(true);
      expect(plotIds.has("perf")).toBe(false);
      // No plotline placement: the new hunk stays unclaimed ("Other").
      const assignedHash = changedHunk.contentHash;
      expect(after.hunkStates.find((s) => s.contentHash === assignedHash)?.plotline).toBeUndefined();
      // Explain recorded the X it explained from.
      expect(after.sinceBaseline).toEqual({ kind: "version", version: 1 });

      // The Since diff filter flag still persists.
      const setFilter = await app.inject({ method: "PATCH", url: `/api/reviews/${id}/diff-filter`, headers: authed, payload: { sinceBaseline: true } });
      expect(setFilter.statusCode).toBe(200);
      const filtered = ctx.reviews.getSnapshot(id)!;
      expect(filtered.diffFilter?.sinceBaseline).toBe(true);
      const sinceSet = new Set([...(filtered.sinceHunks?.added ?? []), ...(filtered.sinceHunks?.changed ?? [])]);
      for (const f of filtered.files) {
        for (const h of f.hunks) {
          const hid = `h:${f.fileKey}:${h.contentHash}`;
          expect(hunkChangedSinceB(hid, filtered.sinceHunks)).toBe(sinceSet.has(hid));
        }
      }
      const clearFilter = await app.inject({ method: "PATCH", url: `/api/reviews/${id}/diff-filter`, headers: authed, payload: { sinceBaseline: false } });
      expect(clearFilter.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.diffFilter).toBeUndefined();
      const badFilter = await app.inject({ method: "PATCH", url: `/api/reviews/${id}/diff-filter`, headers: authed, payload: { sinceBaseline: "yes" } });
      expect(badFilter.statusCode).toBe(400);
    } finally {
      await app.close();
      delete (globalThis as { __snap351?: ReviewSnapshot }).__snap351;
    }
  });

  it("rebase: B not an ancestor still compares by hunk content", () => {
    const key = fileKeyForPath("a.py");
    const rows = (...texts: string[]) => texts.map((text) => ({ kind: "add", text }) as const);
    const bFiles = [{
      fileKey: key,
      path: "a.py",
      category: "source" as const,
      hunks: [{ contentHash: "h1", header: "@@ -1 +1 @@", newStart: 10, newEnd: 12, oldStart: 10, oldEnd: 12, added: 1, removed: 0, lines: rows("same-a", "same-b", "same-c", "same-d") }],
    }];
    // Same content, shifted lines (rebase moved it): no delta.
    const moved = [{
      fileKey: key,
      path: "a.py",
      category: "source" as const,
      hunks: [{ contentHash: "h1", header: "@@ -50 +50 @@", newStart: 50, newEnd: 52, oldStart: 50, oldEnd: 52, added: 1, removed: 0, lines: rows("same-a", "same-b", "same-c", "same-d") }],
    }];
    expect(computeSinceHunks(bFiles, moved)).toEqual({ added: [], changed: [] });
    // Changed content registers as changed, new hunks as added.
    const changed = [{
      fileKey: key,
      path: "a.py",
      category: "source" as const,
      hunks: [
        { contentHash: "h2", header: "@@ -10 +10 @@", newStart: 10, newEnd: 12, oldStart: 10, oldEnd: 12, added: 1, removed: 1, lines: rows("same-a", "same-b", "same-c", "changed-d") },
        { contentHash: "h3", header: "@@ -20 +20 @@", newStart: 20, newEnd: 21, oldStart: 0, oldEnd: 0, added: 1, removed: 0, lines: rows("brand-new") },
      ],
    }];
    const since = computeSinceHunks(bFiles, changed);
    expect(since.changed).toEqual([`h:${key}:h2`]);
    expect(since.added).toEqual([`h:${key}:h3`]);
    expect(hunkChangedSinceB(`h:${key}:h2`, since)).toBe(true);
    expect(hunkChangedSinceB(`h:${key}:h1`, since)).toBe(false);
  });

  it("JsonBlockReplyParser reads the explain fields and drops malformed ones", () => {
    const parser = new JsonBlockReplyParser();
    const ok = parser.parseReply(
      'prose\n```json\n{"baseline":{"kind":"version","version":1},"sinceHunks":{"added":["h:k:a"],"changed":[]},"sinceSection":{"cards":[{"id":"s-1","answers":[{"kind":"comment","id":"7"},{"kind":"nope","id":"x"}]}]}}\n```\n',
    );
    expect(ok.baseline).toEqual({ kind: "version", version: 1 });
    expect(ok.sinceHunks).toEqual({ added: ["h:k:a"], changed: [] });
    expect(ok.sinceSection?.cards).toHaveLength(1);
    expect((ok.sinceSection?.cards[0] as unknown as { answerRefs?: unknown }).answerRefs).toEqual([
      { kind: "comment", id: "7" },
    ]);
    const dropped = parser.parseReply(
      'prose\n```json\n{"baseline":{"kind":"commit","sha":"x"},"sinceHunks":{"added":"nope"}}\n```\n',
    );
    expect(dropped.baseline).toBeUndefined();
    expect(dropped.sinceHunks).toBeUndefined();
  });

  it("JsonBlockReplyParser keeps a commit-sha baseline (step 2)", () => {
    const parser = new JsonBlockReplyParser();
    const sha = "a".repeat(40);
    const ok = parser.parseReply(
      `prose\n\`\`\`json\n{"baseline":{"kind":"commit","sha":"${sha}"}}\n\`\`\`\n`,
    );
    expect(ok.baseline).toEqual({ kind: "commit", sha });
    expect(isSinceBaseline(ok.baseline)).toBe(true);
  });
});

describe("explain uses the requested X, not the stored default (#413)", () => {
  // One-version review: the stored/default baseline is v1, which is the
  // head. The reviewer requests an older commit X instead.
  const c1 = "c1".padEnd(40, "0");
  const headSha = "d4".padEnd(40, "4");
  function snap(): ReviewSnapshot {
    return {
      sinceBaseline: { kind: "version", version: 1 },
      review: {
        id: "r-x",
        currentVersion: 1,
        versions: [
          { n: 1, headSha, mergeBaseSha: "m".repeat(40), baseRef: "main", fetchedAt: 2000, idMapping: {} },
        ],
      },
      version: { n: 1, headSha, mergeBaseSha: "m".repeat(40), baseRef: "main", fetchedAt: 2000, idMapping: {} },
      files: [
        {
          fileKey: "a",
          path: "a.py",
          category: "source",
          hunks: [
            {
              contentHash: "h1",
              header: "@@ -1 +1 @@",
              newStart: 1,
              newEnd: 1,
              oldStart: 1,
              oldEnd: 1,
              added: 1,
              removed: 0,
              lines: [{ kind: "add", text: "x = 2" }],
            },
          ],
        },
      ],
      commits: [{ sha: c1, subject: "rework alpha", body: "The reviewer asked for 2.", files: [], hunks: ["h:a:h1"] }],
      existingComments: [
        {
          id: 7,
          path: "a.py",
          line: 1,
          body: "Should return 2 here.",
          bodyHtml: "Should return 2 here.",
          author: "reviewer",
          // Predates the stored v1 window: a version-X prompt would drop
          // it, but the requested commit X has no lower time bound.
          createdAt: new Date(1000).toISOString(),
        },
      ],
      pages: [],
      annotations: [],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
      ingest: { status: "ready" },
    } as unknown as ReviewSnapshot;
  }

  it("the prompt's Baseline names the requested commit X with its subject", () => {
    const s = snap();
    const since = { added: ["h:a:h1"], changed: [] as string[] };
    const vars = buildExplainVariables(s, since, { baseline: { kind: "commit", sha: c1 } });
    expect(vars.x_context).toContain(`B is commit ${c1.slice(0, 8)} "rework alpha"`);
    expect(vars.x_context).not.toContain("B is v1 ");
    expect(vars.x_hunks).toContain("[[h:a:h1]]");
  });

  it("the feedback window follows the requested X, not the stored default", () => {
    const s = snap();
    const since = { added: ["h:a:h1"], changed: [] as string[] };
    // Requested commit X: no lower time bound, so the old comment counts.
    const fbX = matchSinceFeedback(s, since, { kind: "commit", sha: c1 });
    expect(fbX.baseline).toEqual({ kind: "commit", sha: c1 });
    expect(fbX.comments.map((c) => c.comment.id)).toEqual([7]);
    // Stored default v1 (= head): the same comment is out of window.
    const fbStored = matchSinceFeedback(s, since);
    expect(fbStored.baseline).toEqual({ kind: "version", version: 1 });
    expect(fbStored.comments).toEqual([]);
  });

  it("a requested version X names that version", () => {
    const s = snap();
    s.review.versions.push({
      n: 2,
      headSha,
      mergeBaseSha: "m".repeat(40),
      baseRef: "main",
      fetchedAt: 3000,
      idMapping: {},
    });
    s.review.currentVersion = 2;
    s.version = { ...s.version, n: 2, fetchedAt: 3000 };
    const since = { added: ["h:a:h1"], changed: [] as string[] };
    const vars = buildExplainVariables(s, since, { baseline: { kind: "version", version: 1 } });
    expect(vars.x_context).toContain("B is v1");
  });
});
