/**
 * #178 + #112: `code:` citations to files outside the diff.
 *
 * #178: the pipeline validator must check a `code:` range against the
 * real file at the cited commit (PRD §10), not only hunk coverage — a
 * small PR whose reader cites code outside the hunks must not burn a
 * repair turn or land dimmed citations.
 * #112: on refresh, an outside-diff `code:` citation is re-anchored by
 * content like pins (#52): unchanged keeps it, moved text remaps to a
 * new ID at the new head, gone/unreadable flags it unverified + stale.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { RealCommandRunner } from "../src/exec/index.js";
import { resolveCodeFileExistence } from "../src/pipeline/lookup.js";
import { createApp } from "../src/server.js";
import { remapCardCitations, remapCitationTarget, type CitationCtx } from "../src/versions/citations.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function initRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-codecite-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  return dir;
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("#81 resolveCodeFileExistence", () => {
  it("reports existing files at the cited commit, nothing for missing/binary", async () => {
    const dir = await initRepo();
    try {
      fs.writeFileSync(path.join(dir, "helper.py"), "a = 1\nb = 2\nc = 3\n");
      fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02]));
      await git(dir, "add", ".");
      await git(dir, "commit", "-m", "base");
      const sha = await git(dir, "rev-parse", "HEAD");
      const existing = await resolveCodeFileExistence(real, dir, sha, [
        `code:helper.py:2-3@${sha}`,
        `code:missing.py:1@${sha}`,
        `code:bin.dat:1@${sha}`,
        "diff:a-py:1-2",
      ]);
      expect(existing).toEqual(new Set(["helper.py"]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("#112 remapCitationTarget (content re-anchor)", () => {
  const emptyCmp = { unchanged: [], changed: [], removed: [], added: [], renames: [] };
  const ctx = (codeFiles: CitationCtx["codeFiles"]): CitationCtx => ({
    comparison: emptyCmp as never,
    oldFiles: [],
    newHeadSha: "bbbb2222",
    codeFiles,
  });

  it("unchanged text keeps the lines and bumps to a new ID at the new head", () => {
    const c = ctx(new Map([["helper.py", { oldLines: ["a", "b", "c"], newLines: ["a", "b", "c"], newPath: "helper.py" }]]));
    expect(remapCitationTarget("code:helper.py:2@aaaa1111", c)).toEqual({
      target: "code:helper.py:2@bbbb2222",
      changed: false,
    });
  });

  it("moved text remaps to the shifted lines at the new head", () => {
    const c = ctx(
      new Map([["helper.py", { oldLines: ["a", "b", "c"], newLines: ["x", "y", "a", "b", "c"], newPath: "helper.py" }]]),
    );
    expect(remapCitationTarget("code:helper.py:2-3@aaaa1111", c)).toEqual({
      target: "code:helper.py:4-5@bbbb2222",
      changed: false,
    });
  });

  it("gone text keeps the old ID and flags unverified + stale", () => {
    const c = ctx(new Map([["helper.py", { oldLines: ["a", "b", "c"], newLines: ["a", "z", "c"], newPath: "helper.py" }]]));
    expect(remapCitationTarget("code:helper.py:2@aaaa1111", c)).toEqual({
      target: "code:helper.py:2@aaaa1111",
      changed: true,
      unverified: true,
    });
  });

  it("unreadable at either head flags unverified + stale, never throws", () => {
    const c = ctx(new Map([["helper.py", { oldLines: null, newLines: null, newPath: "helper.py" }]]));
    expect(remapCitationTarget("code:helper.py:2@aaaa1111", c)).toMatchObject({ changed: true, unverified: true });
  });

  it("without preloaded contents it keeps the old sha-bump behaviour", () => {
    const c = ctx(undefined);
    expect(remapCitationTarget("code:helper.py:2@aaaa1111", c)).toEqual({
      target: "code:helper.py:2@bbbb2222",
      changed: false,
    });
  });

  it("remapCardCitations sets and clears the unverified flag", () => {
    const card = {
      id: "c1",
      pageId: "root",
      title: "T",
      level: "standard",
      collapsed: false,
      revision: 1,
      blocks: [
        {
          type: "paragraph",
          id: "b1",
          text: { standard: "see helper" },
          citations: [{ target: "code:helper.py:2@aaaa1111", unverified: true }],
        },
      ],
      undoStack: [],
    } as never;
    const moved = ctx(
      new Map([["helper.py", { oldLines: ["a", "b"], newLines: ["x", "a", "b"], newPath: "helper.py" }]]),
    );
    expect(remapCardCitations(card, moved)).toBe(0);
    const blocks = (card as { blocks: { citations: { target: string; unverified?: boolean }[] }[] }).blocks;
    expect(blocks[0].citations[0]).toEqual({ target: "code:helper.py:3@bbbb2222" });
  });
});

describe("#178 reader with code citations outside the hunks (fake runner)", () => {
  it("lands the guide with verified citations and no repair turn", async () => {
    const agents = new FakeAgentRunner();
    const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
    try {
      const id = `rv_code${Math.random().toString(36).slice(2, 8)}`;
      ctx.db
        .prepare("INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
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
      const snap: ReviewSnapshot = {
        review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
        version: {
          n: 1,
          headSha: "abc1234def5678abc1234def5678abc1234def5",
          mergeBaseSha: "0000000",
          baseRef: "main",
          fetchedAt: Date.now(),
          idMapping: {},
        },
        files: [
          {
            fileKey: "a-py",
            path: "a.py",
            category: "source",
            hunks: [
              {
                contentHash: "h111",
                header: "@@ -1,2 +1,3 @@",
                newStart: 1,
                newEnd: 3,
                oldStart: 1,
                oldEnd: 2,
                added: 1,
                removed: 0,
                lines: [
                  { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
                  { kind: "add", newLine: 2, text: "y = 2" },
                  { kind: "ctx", oldLine: 2, newLine: 3, text: "z = 3" },
                ],
              },
            ],
          },
        ],
        pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
        annotations: [],
        hunkStates: [],
        fileStates: [],
        viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
        ingest: { status: "ready" },
      };
      ctx.reviews.putSnapshot(id, snap);

      // Worktree with a real file outside the diff (helper.py is not in
      // snapshot.files): the reader cites it twice via `code:`.
      const worktree = path.join(ctx.dataDir, "worktrees", id);
      fs.mkdirSync(worktree, { recursive: true });
      await git(worktree, "init", "-b", "main");
      await git(worktree, "config", "user.email", "t@example.com");
      await git(worktree, "config", "user.name", "T");
      fs.writeFileSync(path.join(worktree, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
      fs.writeFileSync(path.join(worktree, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(worktree, "add", ".");
      await git(worktree, "commit", "-m", "base");
      const sha = await git(worktree, "rev-parse", "HEAD");

      agents.addScript({
        match: "Reader",
        events: [
          {
            type: "text",
            delta:
              `## The problem\n\nIt broke. See [[code:helper.py:1-2@${sha}]] for context.\n\n` +
              `## The central change\n\nNow it works, using [[code:helper.py:3@${sha}]].\n\n` +
              "```json\n{}\n```\n",
          },
          { type: "done", stopReason: "end_turn" },
        ],
      });

      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.kind === "reader" && j.state === "done"), 60000);
      // No repair turn was burned on the outside-diff citations.
      expect(agents.prompts.some((p) => p.text.includes("could not be verified"))).toBe(false);
      const root = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.length).toBeGreaterThanOrEqual(2);
      const citations = root.cards.flatMap((c) =>
        c.blocks.flatMap((b) => (b.type === "paragraph" ? b.citations : [])),
      );
      expect(citations.map((c) => c.target)).toEqual(
        expect.arrayContaining([`code:helper.py:1-2@${sha}`, `code:helper.py:3@${sha}`]),
      );
      expect(citations.every((c) => !c.unverified)).toBe(true);
    } finally {
      await app.close();
    }
  }, 90000);
});
