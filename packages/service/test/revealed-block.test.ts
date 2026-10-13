/**
 * Revealed-line host text (issue #133): Explain/Ask anchored outside any
 * hunk reads the line through the file-slice source instead of
 * `(line N not in diff)`. Never throws; hunk-covered lines stay null.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Anchor, ReviewSnapshot } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { revealedBlockText } from "../src/pipeline/actions/common.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<void> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

function anchor(fileKey: string, line: number): Anchor {
  return {
    host: { kind: "diff-line", fileKey, line },
    quotedText: "q",
    prefix: "",
    suffix: "",
    position: line,
    version: 1,
  };
}

function snapshot(): ReviewSnapshot {
  return {
    review: { id: "r1", repoId: "rp", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "HEAD", mergeBaseSha: "HEAD", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [
      {
        fileKey: "a-py",
        path: "a.py",
        category: "source",
        hunks: [
          {
            contentHash: "h1",
            header: "@@",
            newStart: 5,
            newEnd: 5,
            oldStart: 5,
            oldEnd: 5,
            added: 1,
            removed: 0,
            lines: [{ kind: "add", newLine: 5, text: "changed" }],
          },
        ],
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
  };
}

async function worktree(): Promise<string> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-revealed-"));
  const wt = path.join(dataDir, "worktrees", "r1");
  fs.mkdirSync(wt, { recursive: true });
  await git(wt, "init", "-b", "main");
  await git(wt, "config", "user.email", "t@example.com");
  await git(wt, "config", "user.name", "T");
  fs.writeFileSync(path.join(wt, "a.py"), "l1\nl2\nl3\nl4\nchanged\nl6\n");
  await git(wt, "add", ".");
  await git(wt, "commit", "-m", "x");
  return dataDir;
}

function ctxFor(dataDir: string, snap: ReviewSnapshot): Parameters<typeof revealedBlockText>[0] {
  return {
    pipeline: { commands: real, dataDir } as never,
    jobs: {} as never,
    reviews: { getSnapshot: () => snap } as never,
    reviewId: "r1",
  };
}

describe("revealedBlockText", () => {
  it("reads revealed lines and leaves hunk lines alone", async () => {
    const dataDir = await worktree();
    const snap = snapshot();
    const ctx = ctxFor(dataDir, snap);
    expect(await revealedBlockText(ctx, anchor("a-py", 2))).toBe("l2");
    expect(await revealedBlockText(ctx, anchor("a-py", 5))).toBeNull();
    expect(await revealedBlockText(ctx, anchor("nope", 2))).toBeNull();
  });
});
