/**
 * #123: one `git fetch` at ingest (head + base refspecs together), with
 * `gh pr view` running alongside the repo refresh.
 *
 * Real `git` against a local bare origin (fast, no network); `gh` and the
 * refresh are faked with delays so the overlap is observable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner, RunOptions, RunResult } from "../../src/exec/index.js";
import { RealCommandRunner } from "../../src/exec/index.js";
import { ingestReview } from "../../src/ingest/index.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Seed repo with main + feature; push branches (and optionally the pull ref) to a bare origin; return a fresh clone. */
async function makeCloneWithOrigin(opts: { withPullRef: boolean }): Promise<{
  work: string;
  head: string;
  base: string;
}> {
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fetch-seed-"));
  await git(seed, "init", "-b", "main");
  await git(seed, "config", "user.email", "test@example.com");
  await git(seed, "config", "user.name", "Test");
  fs.writeFileSync(path.join(seed, "a.py"), "x = 1\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-m", "base");
  const base = await git(seed, "rev-parse", "HEAD");
  await git(seed, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(seed, "a.py"), "x = 1\ny = 2\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-m", "feature work");
  const head = await git(seed, "rev-parse", "HEAD");

  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fetch-origin-"));
  await git(origin, "init", "--bare", "-q");
  await git(seed, "remote", "add", "origin", origin);
  await git(seed, "push", "-q", "origin", "main", "feature");
  if (opts.withPullRef) {
    await git(seed, "push", "-q", "origin", "feature:refs/pull/42/head");
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fetch-work-"));
  const work = path.join(parent, "work");
  await git(parent, "clone", "-q", origin, work);
  return { work, head, base };
}

interface Span {
  label: string;
  start: number;
  end: number;
}

function prInfo(head: string): string {
  return JSON.stringify({
    title: "Feature",
    body: "Body.",
    author: { login: "octocat" },
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: head,
  });
}

describe("#123 one fetch at ingest", () => {
  it("gh pr view runs alongside the refresh; one fetch carries head + base", async () => {
    const { work, head, base } = await makeCloneWithOrigin({ withPullRef: true });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fetch-data-"));
    const spans: Span[] = [];
    const fetches: string[][] = [];
    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        return await fn();
      } finally {
        spans.push({ label, start, end: Date.now() });
      }
    };
    const runner: CommandRunner = {
      run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
        if (cmd === "gh") {
          return timed("gh", async () => {
            await sleep(300);
            return { stdout: prInfo(head), stderr: "", code: 0 };
          });
        }
        if (cmd === "git" && opts.args[0] === "fetch") {
          fetches.push(opts.args);
        }
        return real.run(cmd, opts);
      },
    };
    // The repo-wide refresh the service starts for managed checkouts.
    const refreshP = (async (): Promise<unknown> => {
      const start = Date.now();
      try {
        await sleep(300);
        return null;
      } finally {
        spans.push({ label: "refresh", start, end: Date.now() });
      }
    })();

    const t0 = Date.now();
    const out = await ingestReview({ runner, dataDir }, { repoPath: work, pr: 42 }, undefined, refreshP);
    const elapsed = Date.now() - t0;

    expect(out.version.headSha).toBe(head);
    expect(out.version.mergeBaseSha).toBe(base);
    expect(out.files.length).toBeGreaterThan(0);
    // One git fetch, both refspecs.
    expect(fetches).toEqual([["fetch", "origin", "refs/pull/42/head", "main"]]);
    // gh and the refresh overlapped (sequentially they would take 600 ms+).
    const gh = spans.find((s) => s.label === "gh")!;
    const rf = spans.find((s) => s.label === "refresh")!;
    expect(gh.start).toBeLessThan(rf.end);
    expect(rf.start).toBeLessThan(gh.end);
    expect(elapsed).toBeLessThan(550);
  });

  it("falls back to branch + base fetches when the remote has no pull refs", async () => {
    const { work, head, base } = await makeCloneWithOrigin({ withPullRef: false });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fetch-data-"));
    const fetches: string[][] = [];
    const runner: CommandRunner = {
      run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
        if (cmd === "gh") return { stdout: prInfo(head), stderr: "", code: 0 };
        if (cmd === "git" && opts.args[0] === "fetch") fetches.push(opts.args);
        return real.run(cmd, opts);
      },
    };
    const out = await ingestReview({ runner, dataDir }, { repoPath: work, pr: 42 });
    expect(out.version.headSha).toBe(head);
    expect(out.version.mergeBaseSha).toBe(base);
    // Combined attempt first (fails on the pull refspec), then the #93
    // per-refspec fallback: branch head + base.
    expect(fetches[0]).toEqual(["fetch", "origin", "refs/pull/42/head", "main"]);
    expect(fetches.slice(1)).toEqual([
      ["fetch", "origin", "feature"],
      ["fetch", "origin", "main"],
    ]);
  });
});
