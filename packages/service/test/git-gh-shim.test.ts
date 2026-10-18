/**
 * Issue #109: the service's own `git`/`gh` calls run with a review
 * worktree as cwd. When those tools are version-manager shims, the shim
 * reads the reviewed repo's config there and can fail (mise trust) or pick
 * a different version. The service must run the real executables instead:
 * resolved once from a neutral directory through the manager, and the
 * command runner must use those paths rather than each call site.
 *
 * No real mise/GitHub: fake shims + a fake `mise` in temp dirs (POSIX sh,
 * `node:os`/`node:path`, macOS + Linux), stubbed via FakeCommandRunner
 * where the runner is not under test, and a real spawn where it is.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/runner.js";
import {
  clearShimResolutionCache,
  resolveServiceToolPath,
  ShimResolvingCommandRunner,
} from "../src/exec/shim-resolve.js";
import { diagnoseTool, TOOL_SPECS } from "../src/diagnostics/tools.js";

const MARKER = ".unvibe-shim-marker";

function writeExec(file: string, body: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

interface FakeTree {
  root: string;
  shimDir: string;
  managersDir: string;
  realDir: string;
  worktree: string;
  real: Record<"git" | "gh", string>;
  shim: Record<"git" | "gh", string>;
  miseBin: string;
  pathValue: string;
}

function makeFakeTree(): FakeTree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shim109-"));
  const realDir = path.join(root, "real");
  const shimDir = path.join(root, ".local", "share", "mise", "shims");
  const managersDir = path.join(root, "managers");
  const worktree = path.join(root, "worktree");
  for (const d of [realDir, shimDir, managersDir, worktree]) fs.mkdirSync(d, { recursive: true });

  const real = {
    git: writeExec(path.join(realDir, "git-real"), "#!/bin/sh\necho 'git version 2.50.0'\n"),
    gh: writeExec(path.join(realDir, "gh-real"), "#!/bin/sh\necho 'gh version 2.70.0'\n"),
  };
  const shimBody = (tool: string, version: string): string =>
    `#!/bin/sh\n# fake mise shim\ndir="$PWD"\nwhile [ "$dir" != "/" ]; do\n  if [ -e "$dir/${MARKER}" ]; then\n    echo "mise ERROR Config files in $dir/.mise.toml are not trusted." >&2\n    exit 1\n  fi\n  dir=$(dirname "$dir")\ndone\necho '${tool} version ${version}'\n`;
  const shim = {
    git: writeExec(path.join(shimDir, "git"), shimBody("git", "2.50.0")),
    gh: writeExec(path.join(shimDir, "gh"), shimBody("gh", "2.70.0")),
  };
  const miseBin = writeExec(
    path.join(managersDir, "mise"),
    `#!/bin/sh\nif [ "$1" = "which" ]; then\n  case "$2" in\n    git) echo "${real.git}" ;;\n    gh) echo "${real.gh}" ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\nexit 1\n`,
  );
  fs.writeFileSync(path.join(worktree, MARKER), "untrusted review config");
  fs.writeFileSync(path.join(worktree, ".mise.toml"), '[tools]\nnode = "24"\n');
  return {
    root,
    shimDir,
    managersDir,
    realDir,
    worktree,
    real,
    shim,
    miseBin,
    pathValue: `${shimDir}${path.delimiter}${managersDir}`,
  };
}

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});
beforeEach(() => {
  clearShimResolutionCache();
});

describe("resolveServiceToolPath (issue #109)", () => {
  it("resolves a mise shim for git and gh to the real executable", async () => {
    const tree = makeFakeTree();
    try {
      const fake = new FakeCommandRunner();
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "git"], stdout: `${tree.real.git}\n`, stderr: "", code: 0 });
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "gh"], stdout: `${tree.real.gh}\n`, stderr: "", code: 0 });
      expect(
        await resolveServiceToolPath("git", { pathValue: tree.pathValue, runner: fake as never }),
      ).toBe(tree.real.git);
      expect(
        await resolveServiceToolPath("gh", { pathValue: tree.pathValue, runner: fake as never }),
      ).toBe(tree.real.gh);
      // The manager was asked from a neutral directory, never the worktree.
      expect(fake.calls.every((c) => c.opts.cwd === os.homedir())).toBe(true);
      // Cached: a second lookup asks the manager no more.
      expect(
        await resolveServiceToolPath("git", { pathValue: tree.pathValue, runner: fake as never }),
      ).toBe(tree.real.git);
      expect(fake.calls).toHaveLength(2);
    } finally {
      fs.rmSync(tree.root, { recursive: true, force: true });
    }
  });

  it("uses a non-shim candidate as-is and returns null when absent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-plain109-"));
    try {
      const plain = writeExec(path.join(dir, "git"), "#!/bin/sh\necho 'git version 2.50.0'\n");
      const fake = new FakeCommandRunner();
      expect(await resolveServiceToolPath("git", { pathValue: dir, runner: fake as never })).toBe(plain);
      expect(await resolveServiceToolPath("gh", { pathValue: dir, runner: fake as never })).toBeNull();
      expect(fake.calls).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the shim when the manager has no answer", async () => {
    const tree = makeFakeTree();
    try {
      const fake = new FakeCommandRunner();
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "git"], stdout: "", stderr: "no such tool", code: 1 });
      expect(
        await resolveServiceToolPath("git", { pathValue: tree.pathValue, runner: fake as never }),
      ).toBe(tree.shim.git);
    } finally {
      fs.rmSync(tree.root, { recursive: true, force: true });
    }
  });
});

describe("ShimResolvingCommandRunner (issue #109)", () => {
  it("runs the resolved real git/gh instead of the shim, with real dirs first on PATH", async () => {
    const tree = makeFakeTree();
    try {
      const fake = new FakeCommandRunner();
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "git"], stdout: `${tree.real.git}\n`, stderr: "", code: 0 });
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "gh"], stdout: `${tree.real.gh}\n`, stderr: "", code: 0 });
      fake.enqueue({ cmd: tree.real.git, args: ["status"], stdout: "clean", stderr: "", code: 0 });
      const runner = new ShimResolvingCommandRunner(fake as never, { pathValue: tree.pathValue });
      const res = await runner.run("git", { args: ["status"], cwd: tree.worktree });
      expect(res.stdout).toBe("clean");
      const toolCall = fake.calls[fake.calls.length - 1];
      expect(toolCall.cmd).toBe(tree.real.git);
      expect(toolCall.opts.cwd).toBe(tree.worktree);
      // Nested tool lookups (`gh` run by git as its credential helper)
      // also find the real binaries before any shim directory.
      expect(toolCall.opts.env?.PATH?.split(path.delimiter)[0]).toBe(tree.realDir);
    } finally {
      fs.rmSync(tree.root, { recursive: true, force: true });
    }
  });

  it("passes other commands through untouched", async () => {
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: "npm", args: ["--version"], stdout: "11.0.0", stderr: "", code: 0 });
    const runner = new ShimResolvingCommandRunner(fake as never, { pathValue: "" });
    const res = await runner.run("npm", { args: ["--version"] });
    expect(res.stdout).toBe("11.0.0");
    expect(fake.calls[0].cmd).toBe("npm");
  });

  it("a git and a gh call made in a worktree run the real binaries (real spawn)", async () => {
    const tree = makeFakeTree();
    try {
      process.env.PATH = `${tree.pathValue}${path.delimiter}${savedPath ?? ""}`;
      const runner = new ShimResolvingCommandRunner(new RealCommandRunner());
      const git = await runner.run("git", { args: ["--version"], cwd: tree.worktree, timeoutMs: 8000 });
      expect(git.code).toBe(0);
      expect(git.stdout).toContain("git version");
      const gh = await runner.run("gh", { args: ["--version"], cwd: tree.worktree, timeoutMs: 8000 });
      expect(gh.code).toBe(0);
      expect(gh.stdout).toContain("gh version");
    } finally {
      fs.rmSync(tree.root, { recursive: true, force: true });
    }
  });
});

describe("doctor diagnosis for git/gh (issue #109)", () => {
  it("shows the resolved real path for a shim that fails in a review copy", async () => {
    const tree = makeFakeTree();
    try {
      const fake = new FakeCommandRunner();
      // Shim probed from a worktree-shaped directory: trust failure.
      fake.enqueue({
        cmd: tree.shim.git,
        args: ["--version"],
        stdout: "",
        stderr: "mise ERROR Config files are not trusted.",
        code: 1,
      });
      fake.enqueue({ cmd: tree.miseBin, args: ["which", "git"], stdout: `${tree.real.git}\n`, stderr: "", code: 0 });
      fake.enqueue({ cmd: tree.real.git, args: ["--version"], stdout: "git version 2.50.0", stderr: "", code: 0 });
      const spec = TOOL_SPECS.find((s) => s.tool === "git")!;
      const diag = await diagnoseTool(spec, {
        pathValue: tree.pathValue,
        env: {},
        runner: fake as never,
        timeoutMs: 3000,
      });
      expect(diag.candidates[0].resolvedPath).toBe(tree.real.git);
      expect(diag.chosen).toBe(tree.real.git);
    } finally {
      fs.rmSync(tree.root, { recursive: true, force: true });
    }
  });
});
