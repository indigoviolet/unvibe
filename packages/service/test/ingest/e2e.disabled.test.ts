// DISABLED(#188): covered by J1
/**
 * End-to-end ingest against a temporary git repo: real `git`, fake `gh`.
 * Covers branch and PR sources, merge-base diffing, hashing, categories,
 * worktree creation, and the description tab sources.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../../src/exec/index.js";
import { FakeCommandRunner, RealCommandRunner } from "../../src/exec/index.js";
import { ingestReview } from "../../src/ingest/index.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** Build a repo: main base + a feature branch with a source + new-file change. */
async function makeRepo(): Promise<{ dir: string; base: string; head: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-e2e-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "a.py"), "import os\n\n\ndef first():\n    return 1\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base commit");
  const base = await git(dir, "rev-parse", "HEAD");
  await git(dir, "checkout", "-b", "feature");
  fs.writeFileSync(
    path.join(dir, "a.py"),
    "import os\nimport sys\n\n\ndef first():\n    return 1\n\n\ndef second():\n    return 2\n",
  );
  fs.writeFileSync(path.join(dir, "notes.txt"), "hello\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "Add second helper\n\nLonger body line.");
  const head = await git(dir, "rev-parse", "HEAD");
  return { dir, base, head };
}

/** Forbid `gh`: branch ingest must be pure git. */
function gitOnlyRunner(): CommandRunner {
  return {
    run: (cmd, opts) => {
      if (cmd === "gh") throw new Error("gh must not be called for branch ingest");
      return real.run(cmd, opts);
    },
  };
}

describe("ingestReview (branch, real git)", () => {
  it("ingests a local branch end to end", async () => {
    const { dir, base, head } = await makeRepo();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-e2e-data-"));

    const out = await ingestReview(
      { runner: gitOnlyRunner(), dataDir },
      { repoPath: dir, branch: "feature" },
    );

    expect(out.review.branch).toBe("feature");
    expect(out.review.prNumber).toBeUndefined();
    expect(out.version.headSha).toBe(head);
    expect(out.version.mergeBaseSha).toBe(base);
    expect(out.version.baseRef).toBe("main");

    const paths = out.files.map((f) => f.path).sort();
    expect(paths).toEqual(["a.py", "notes.txt"]);
    const a = out.files.find((f) => f.path === "a.py");
    expect(a?.category).toBe("source");
    expect(a?.hunks.length).toBeGreaterThan(0);
    for (const h of a?.hunks ?? []) {
      expect(h.contentHash).toMatch(/^[0-9a-f]{16}$/);
      expect(h.lines.length).toBeGreaterThan(0);
      // One-line-change rule: single-change hunks are never hidden.
      if (h.added + h.removed <= 1) expect(h.hiddenReason).toBeUndefined();
    }
    const notes = out.files.find((f) => f.path === "notes.txt");
    expect(notes?.isNew).toBe(true);
    expect(notes?.category).toBe("docs");

    // Branch description = commit messages, read-only.
    expect(out.description.source).toBe("commits");
    expect(out.description.editable).toBe(false);
    expect(out.description.html).toContain("Add second helper");

    // Managed worktree beside the data dir, at the head SHA.
    expect(out.worktreePath.startsWith(path.join(dataDir, "worktrees"))).toBe(true);
    expect(await git(out.worktreePath, "rev-parse", "HEAD")).toBe(head);
    // The user's checkout gained no worktree files.
    expect(fs.existsSync(path.join(dir, "worktrees"))).toBe(false);
  });
});

describe("ingestReview (PR, fake gh + real git)", () => {
  it("ingests a PR with rendered description", async () => {
    const { dir, head } = await makeRepo();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-e2e-data-"));
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "gh",
      stdout: JSON.stringify({
        title: "Add second helper",
        body: "First paragraph.\n\nSecond paragraph with `code`.",
        author: { login: "octocat" },
        state: "OPEN",
        isDraft: false,
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: head,
      }),
      stderr: "",
      code: 0,
    });
    const runner: CommandRunner = {
      run: (cmd, opts) => (cmd === "gh" ? fake.run(cmd, opts) : real.run(cmd, opts)),
    };

    const out = await ingestReview({ runner, dataDir }, { repoPath: dir, pr: 42 });

    expect(out.review.prNumber).toBe(42);
    expect(out.review.branch).toBe("feature");
    expect(out.version.headSha).toBe(head);
    expect(out.files.length).toBeGreaterThan(0);
    expect(out.description.source).toBe("pr");
    expect(out.description.editable).toBe(true);
    expect(out.description.rev).toBe("1");
    expect(out.description.html).toContain('id="d-p1"');
    expect(out.description.html).toContain('id="d-p2"');
    expect(out.description.html).toContain("<code>code</code>");
    // gh ran with GITHUB_TOKEN unset (exec contract).
    expect(fake.calls[0].opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
  });
});
