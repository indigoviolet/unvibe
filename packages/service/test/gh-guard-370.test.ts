/**
 * Test services never resolve the real `gh` (issue #370).
 *
 * A Playwright-spawned test service applies the login-shell PATH at boot.
 * When the harness's fake-shell probe output was malformed, the probe fell
 * through to the real login shell, the real `gh` came first, and ingest
 * called it with the developer's login. Three backstops, all covered here:
 *
 * 1. Under `UNVIBE_TEST=1` the service never applies the login-shell PATH
 *    (`applyLoginShellPath` is a no-op; the inherited PATH keeps the
 *    harness fakes first).
 * 2. `isTestProcess` covers `UNVIBE_TEST`, so every test-spawned service
 *    (vitest or Playwright) builds with the `TestCommandGuard` default.
 * 3. With `UNVIBE_TEST_BIN_DIR` set, the guard confines `gh`/`git` to the
 *    harness fake bin dir: a binary resolving outside it is refused loudly
 *    — even with a polluted PATH and a working "real" binary on it.
 *
 * The sentinel below plays the real `gh`/`git`: working binaries that
 * record being called. Every assertion also checks the sentinel log was
 * never touched.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { applyLoginShellPath } from "../src/diagnostics/path-probe.js";
import { isTestProcess, buildApp } from "../src/app.js";
import { RealCommandRunner, TestCommandGuard } from "../src/exec/index.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";

const ENV_KEYS = ["PATH", "SHELL", "UNVIBE_TEST", "UNVIBE_TEST_BIN_DIR", "VITEST", "NODE_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

const tmpDirs: string[] = [];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop() as string;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function makeExecutable(dir: string, name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, body, { mode: 0o755 });
  chmodSync(file, 0o755);
  return file;
}

/**
 * Fake bin dir (the harness fakes) plus a sentinel dir playing the
 * developer's real tools: working `gh`/`git` binaries that record being
 * called. The sentinel log must stay untouched in every test.
 */
function makeFakeAndSentinel(): { fakeBin: string; sentinelBin: string; sentinelLog: string } {
  const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
  const fakeBin = mkdtempSync(join(tmpdir(), "unvibe-370-fake-"));
  const sentinelBin = mkdtempSync(join(tmpdir(), "unvibe-370-real-"));
  tmpDirs.push(fakeBin, sentinelBin);
  makeExecutable(fakeBin, "gh", '#!/bin/sh\necho "fake-gh-ok"\n');
  makeExecutable(fakeBin, "git", `#!/bin/sh\nexec "${realGit}" "$@"\n`);
  const sentinelLog = join(sentinelBin, "calls.log");
  for (const name of ["gh", "git"]) {
    makeExecutable(
      sentinelBin,
      name,
      `#!/bin/sh\necho "${name} $*" >> "${sentinelLog}"\n` +
        (name === "gh" ? 'echo "sentinel-gh: should never run"\n' : `exec "${realGit}" "$@"\n`),
    );
  }
  return { fakeBin, sentinelBin, sentinelLog };
}

function sentinelCalls(sentinelLog: string): string[] {
  if (!existsSync(sentinelLog)) return [];
  return readFileSync(sentinelLog, "utf8").split("\n").filter(Boolean);
}

describe("issue #370: test services never resolve the real gh", () => {
  it("isTestProcess covers UNVIBE_TEST (Playwright services have no VITEST marker)", () => {
    expect(isTestProcess({ UNVIBE_TEST: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isTestProcess({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isTestProcess({ UNVIBE_TEST: "0", VITEST: "false", NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("applyLoginShellPath is a no-op under UNVIBE_TEST (keeps the harness PATH)", async () => {
    const before = "/usr/bin:/bin";
    process.env.PATH = before;
    process.env.SHELL = "/nonexistent/broken-shell-370";
    process.env.UNVIBE_TEST = "1";
    const applied = await applyLoginShellPath();
    expect(applied).toBeNull();
    expect(process.env.PATH).toBe(before);
  });

  it("buildApp without VITEST but with UNVIBE_TEST still defaults to the guard", () => {
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    process.env.UNVIBE_TEST = "1";
    expect(isTestProcess()).toBe(true);
    const db = openDatabase(":memory:");
    migrate(db);
    const ctx = buildApp({ db });
    expect(ctx.runner).toBeInstanceOf(TestCommandGuard);
  });

  it("guard runs the fake gh/git and never touches the sentinel", async () => {
    const { fakeBin, sentinelBin, sentinelLog } = makeFakeAndSentinel();
    process.env.UNVIBE_TEST = "1";
    process.env.UNVIBE_TEST_BIN_DIR = fakeBin;
    process.env.PATH = `${fakeBin}:${sentinelBin}:${savedEnv.PATH ?? "/usr/bin:/bin"}`;
    const guard = new TestCommandGuard(new RealCommandRunner());
    const gh = await guard.run("gh", { args: ["auth", "status"] });
    expect(gh.stdout).toContain("fake-gh-ok");
    const git = await guard.run("git", { args: ["--version"] });
    expect(git.stdout).toMatch(/git version/);
    expect(sentinelCalls(sentinelLog)).toEqual([]);
  });

  it("guard refuses loudly when the sentinel comes first on PATH (malformed-probe pollution)", async () => {
    const { fakeBin, sentinelBin, sentinelLog } = makeFakeAndSentinel();
    process.env.UNVIBE_TEST = "1";
    process.env.UNVIBE_TEST_BIN_DIR = fakeBin;
    // Worst case of the #370 breach: the real login PATH (sentinel) first,
    // as if a malformed probe had been applied — the guard must refuse,
    // not fall through to the working sentinel binary.
    process.env.PATH = `${sentinelBin}:${fakeBin}:${savedEnv.PATH ?? "/usr/bin:/bin"}`;
    const guard = new TestCommandGuard(new RealCommandRunner());
    await expect(guard.run("gh", { args: ["pr", "view", "1"] })).rejects.toThrow(
      /outside the harness fake bin dir/,
    );
    await expect(guard.run("git", { args: ["--version"] })).rejects.toThrow(
      /outside the harness fake bin dir/,
    );
    expect(sentinelCalls(sentinelLog)).toEqual([]);
  });

  it("guard refuses absolute paths outside the fake bin dir", async () => {
    const { fakeBin, sentinelBin, sentinelLog } = makeFakeAndSentinel();
    process.env.UNVIBE_TEST = "1";
    process.env.UNVIBE_TEST_BIN_DIR = fakeBin;
    process.env.PATH = `${fakeBin}:${savedEnv.PATH ?? "/usr/bin:/bin"}`;
    const guard = new TestCommandGuard(new RealCommandRunner());
    await expect(guard.run(join(sentinelBin, "gh"), { args: ["auth", "status"] })).rejects.toThrow(
      /outside the harness fake bin dir/,
    );
    // ... while the fake itself stays runnable by absolute path.
    const gh = await guard.run(join(fakeBin, "gh"), { args: ["auth", "status"] });
    expect(gh.stdout).toContain("fake-gh-ok");
    expect(sentinelCalls(sentinelLog)).toEqual([]);
  });

  it("without a fake bin dir the old behavior holds (gh blocked, git passes)", async () => {
    delete process.env.UNVIBE_TEST_BIN_DIR;
    const guard = new TestCommandGuard(new RealCommandRunner());
    await expect(guard.run("gh", { args: ["auth", "status"] })).rejects.toThrow(/refusing to spawn real/);
  });
});
