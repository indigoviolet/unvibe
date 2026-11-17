/**
 * versions/explain: explain-since-X with a fake prompt runner.
 *
 * - The route enqueues an `explain-pass` job (202 + jobId) any time the
 *   diff is non-empty — no staleness gate. Empty diffs stay 409.
 * - The job sends only the X→head hunks (prompt snapshot contains the
 *   `h:` IDs, not the full diff), parses the fake reply, and applies
 *   it: the Changes-since-X section is replaced whole and the old
 *   guide is left untouched.
 * - `JsonBlockReplyParser` unit: trailing block parsing; unknown-shape
 *   fields are ignored, missing blocks throw.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExplainPassResult, ReviewSnapshot } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { JobQueue } from "../src/jobs/index.js";
import { createApp } from "../src/server.js";
import { JsonBlockReplyParser } from "../src/versions/explain.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function fakeReply(hunkId: string): string {
  const result: ExplainPassResult = {
    baseline: { kind: "version", version: 1 },
    sinceHunks: { added: [hunkId], changed: [] },
    sinceSection: {
      cards: [{
        id: "x-1",
        pageId: "since",
        title: "Alpha reworked",
        collapsed: false,
        revision: 1,
        undoStack: [],
        blocks: [{
          type: "paragraph",
          id: "b-x-1",
          text: "Alpha now returns the new value, per the change commit.",
          citations: [{ target: hunkId }],
        }],
      }],
    },
  };
  return `Alpha changed since v1.\n\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n`;
}

describe("explain pass", () => {
  it("enqueues, runs on the fake base runner, and replaces the section whole", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-m5e-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
    await git(dir, "commit", "-am", "change");

    const queue = new JobQueue();
    const seenPrompts: string[] = [];
    const baseRunner = {
      runExplainPrompt: async (prompt: string) => {
        seenPrompts.push(prompt);
        const snap = (globalThis as { __snap?: ReviewSnapshot }).__snap;
        const h = snap!.files[0].hunks[0];
        const hunkId = `h:${snap!.files[0].fileKey}:${h.contentHash}`;
        return fakeReply(hunkId);
      },
    };
    const { app, ctx } = await createApp("tok", { runner: real, jobs: queue, baseRunner, autoPipeline: false });
    try {
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch: "feature" } });
      const loading = created.json() as ReviewSnapshot;
      const id = loading.review.id;
      // #92: wait for the background ingest (explain refuses loading).
      {
        const start = Date.now();
        while (Date.now() - start < 15000) {
          const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
          if (got.statusCode === 200) {
            const snap = got.json() as ReviewSnapshot;
            if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Fresh review: explain runs (no staleness gate), defaulting X.
      const before = ctx.reviews.getSnapshot(id)!;
      const beforePages = JSON.stringify(before.pages);
      (globalThis as { __snap?: ReviewSnapshot }).__snap = before;

      const enq = await app.inject({ method: "POST", url: `/api/reviews/${id}/explain`, headers: authed, payload: {} });
      expect(enq.statusCode).toBe(202);
      const { jobId } = enq.json() as { jobId: string };
      expect(typeof jobId).toBe("string");

      await queue.drain(5000);
      const job = queue.get(jobId)!;
      expect(job.state).toBe("done");
      expect(job.kind).toBe("explain-pass");
      expect(job.promptSnapshot).toContain("Changed and new hunks (X to head)");
      expect(seenPrompts).toHaveLength(1);

      const after = ctx.reviews.getSnapshot(id)!;
      // The section is written, header naming X, cards with bodies.
      expect(after.sinceSection?.baseline).toEqual({ kind: "version", version: 1 });
      expect(after.sinceSection?.headVersion).toBe(after.review.currentVersion);
      expect(after.sinceSection?.cards).toHaveLength(1);
      const card = after.sinceSection!.cards[0];
      expect(card.title).toBe("Alpha reworked");
      expect(card.blocks.length).toBeGreaterThan(0);
      // The old guide is untouched: same pages, no version-status write.
      expect(JSON.stringify(after.pages)).toBe(beforePages);
      expect(after.versionStatus).toBe(before.versionStatus);

      // An explicit commit X is accepted too.
      const commits = (ctx.reviews.getSnapshot(id)!.commits ?? []);
      expect(commits.length).toBeGreaterThan(0);
      const enq2 = await app.inject({
        method: "POST", url: `/api/reviews/${id}/explain`, headers: authed, payload: { sha: commits[0].sha },
      });
      expect(enq2.statusCode).toBe(202);
      await queue.drain(5000);
      const job2 = queue.get((enq2.json() as { jobId: string }).jobId)!;
      expect(job2.state).toBe("done");
      // A re-run replaces the section whole (still one card).
      expect(ctx.reviews.getSnapshot(id)?.sinceSection?.cards).toHaveLength(1);
    } finally {
      await app.close();
      delete (globalThis as { __snap?: ReviewSnapshot }).__snap;
    }
  });

  it("JsonBlockReplyParser parses the trailing block and ignores unknown fields", () => {
    const parser = new JsonBlockReplyParser();
    const ok = parser.parseReply(
      'prose\n```json\n{"revisedCards":[],"sinceSection":{"cards":[]},"sinceHunks":{"added":["h:a:b"],"changed":[]}}\n```\n',
    );
    expect(ok.sinceHunks).toEqual({ added: ["h:a:b"], changed: [] });
    expect(ok.sinceSection).toEqual({ cards: [] });
    expect(() => parser.parseReply("no block here")).toThrow(/expected format/);
    expect(() => parser.parseReply("```json\nnot json\n```")).toThrow(/does not parse/);
  });
});
