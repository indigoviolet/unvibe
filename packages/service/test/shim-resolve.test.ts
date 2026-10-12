/**
 * Shim resolution (issue #105): `mise which` / `asdf which` from a neutral
 * directory, caching + reload refresh, override precedence, the
 * MISE_IGNORED_CONFIG_PATHS layer, and the plain-words session-start
 * error. No mise needed: the managers are scripted through
 * FakeCommandRunner.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  clearShimResolutionCache,
  friendlySessionStartError,
  isResolvableShim,
  isVersionManagerTrustFailure,
  miseIgnoreEnv,
  resolveShimTarget,
} from "../src/exec/shim-resolve.js";

function makeManagerBin(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return file;
}

function makeRealBin(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\necho real\n", { mode: 0o755 });
  return file;
}

describe("resolveShimTarget", () => {
  beforeEach(() => {
    clearShimResolutionCache();
  });

  it("asks mise for the real path from the neutral directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-resolve-"));
    const miseBin = makeManagerBin(dir, "mise");
    const real = makeRealBin(dir, "claude-real");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: miseBin, args: ["which", "claude"], stdout: `${real}\n`, stderr: "", code: 0 });
    const out = await resolveShimTarget({
      tool: "claude",
      candidatePath: path.join(dir, "shims", "claude"),
      manager: "mise",
      pathValue: dir,
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(out).toBe(real);
    // Resolved from the neutral directory (home), never a worktree.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].opts.cwd).toBe(os.homedir());
    expect(fake.calls[0].opts.args).toEqual(["which", "claude"]);
  });

  it("supports asdf the same way", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-resolve-asdf-"));
    const asdfBin = makeManagerBin(dir, "asdf");
    const real = makeRealBin(dir, "codex-real");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: asdfBin, args: ["which", "codex"], stdout: `${real}\n`, stderr: "", code: 0 });
    const out = await resolveShimTarget({
      tool: "codex",
      candidatePath: path.join(dir, "shims", "codex"),
      manager: "asdf",
      pathValue: dir,
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(out).toBe(real);
  });

  it("returns null when the manager has no answer, and never throws", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-resolve-miss-"));
    const miseBin = makeManagerBin(dir, "mise");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: miseBin, args: ["which", "claude"], stdout: "", stderr: "no such tool", code: 1 });
    const out = await resolveShimTarget({
      tool: "claude",
      candidatePath: path.join(dir, "shims", "claude"),
      manager: "mise",
      pathValue: dir,
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(out).toBeNull();
    // Unknown managers and throwing runners also resolve to null.
    expect(
      await resolveShimTarget({
        tool: "claude",
        candidatePath: path.join(dir, "x"),
        manager: "volta",
        pathValue: dir,
        runner: fake as never,
      }),
    ).toBeNull();
    expect(
      await resolveShimTarget({
        tool: "claude",
        candidatePath: path.join(dir, "y"),
        manager: "mise",
        pathValue: "/nonexistent-dir-xyz",
        runner: new FakeCommandRunner() as never,
      }),
    ).toBeNull();
  });

  it("caches the result and Reload environment refreshes it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-resolve-cache-"));
    const miseBin = makeManagerBin(dir, "mise");
    const real = makeRealBin(dir, "claude-real");
    const fake = new FakeCommandRunner();
    const opts = {
      tool: "claude",
      candidatePath: path.join(dir, "shims", "claude"),
      manager: "mise",
      pathValue: dir,
      runner: fake as never,
      timeoutMs: 3000,
    };
    fake.enqueue({ cmd: miseBin, args: ["which", "claude"], stdout: `${real}\n`, stderr: "", code: 0 });
    expect(await resolveShimTarget(opts)).toBe(real);
    // Second call is cached: no new manager invocation.
    expect(await resolveShimTarget(opts)).toBe(real);
    expect(fake.calls).toHaveLength(1);
    // Reload clears the cache: the manager is asked again.
    clearShimResolutionCache();
    fake.enqueue({ cmd: miseBin, args: ["which", "claude"], stdout: `${real}\n`, stderr: "", code: 0 });
    expect(await resolveShimTarget(opts)).toBe(real);
    expect(fake.calls).toHaveLength(2);
  });
});

describe("isResolvableShim", () => {
  it("resolves PATH shims from known managers, never overrides", () => {
    expect(isResolvableShim({ kind: "shim (mise)", shimManager: "mise", source: "login-shell PATH" })).toBe(true);
    expect(isResolvableShim({ kind: "shim (asdf)", shimManager: "asdf", source: "login-shell PATH" })).toBe(true);
    // Explicit overrides win unchanged, even when they point at a shim.
    expect(isResolvableShim({ kind: "shim (mise)", shimManager: "mise", source: "env UNVIBE_CLAUDE_BIN" })).toBe(false);
    expect(isResolvableShim({ kind: "override (shim (mise))", shimManager: "mise", source: "env CODEX_PATH" })).toBe(false);
    // Real files and unknown managers are used as-is.
    expect(isResolvableShim({ kind: "file", source: "login-shell PATH" })).toBe(false);
    expect(isResolvableShim({ kind: "file (mise)", shimManager: "mise", source: "login-shell PATH" })).toBe(false);
    expect(isResolvableShim({ kind: "shim (something)", shimManager: "volta", source: "login-shell PATH" })).toBe(false);
  });
});

describe("miseIgnoreEnv", () => {
  it("points mise at our worktrees dir, keeping existing entries", () => {
    const dataDir = path.join(os.tmpdir(), "unvibe-data-xyz");
    const wt = path.join(dataDir, "worktrees");
    expect(miseIgnoreEnv(dataDir, {})).toEqual({ MISE_IGNORED_CONFIG_PATHS: wt });
    expect(miseIgnoreEnv(dataDir, { MISE_IGNORED_CONFIG_PATHS: "/opt/other" })).toEqual({
      MISE_IGNORED_CONFIG_PATHS: `/opt/other${path.delimiter}${wt}`,
    });
    // No duplication when already present.
    expect(miseIgnoreEnv(dataDir, { MISE_IGNORED_CONFIG_PATHS: wt })).toEqual({ MISE_IGNORED_CONFIG_PATHS: wt });
  });
});

describe("session-start error text (issue #105)", () => {
  const RAW =
    'acp claude session/new failed: Internal error :: {"details":"Claude Code process exited with code 1. ' +
    'stderr: mise ERROR Config files in ~/.local/share/unvibe/worktrees/rv_0d1a/.mise.toml are not trusted. ' +
    'Trust them with `mise trust`."}';

  it("detects the version-manager refusal", () => {
    expect(isVersionManagerTrustFailure(RAW)).toBe(true);
    expect(isVersionManagerTrustFailure("mise ERROR something else")).toBe(true);
    expect(isVersionManagerTrustFailure("connection reset")).toBe(false);
  });

  it("names the command, the cause and the fix — with the real path when known", () => {
    const withBin = friendlySessionStartError("claude", RAW, "/Users/you/.local/share/mise/installs/claude/2.1.296/bin/claude");
    expect(withBin).toBe(
      "couldn't start a claude session: the claude command would not run inside the review's working copy — " +
        "its version manager refused the review's settings " +
        "(it tried /Users/you/.local/share/mise/installs/claude/2.1.296/bin/claude). " +
        "Set UNVIBE_CLAUDE_BIN to the real claude executable and restart the service " +
        "(`mise which claude` prints the real path).",
    );
    const codexNoBin = friendlySessionStartError("codex", RAW, null);
    expect(codexNoBin).toContain("couldn't start a codex session:");
    expect(codexNoBin).toContain("UNVIBE_CODEX_BIN");
    expect(codexNoBin).toContain("`mise which codex`");
    // Plain words only: no internals, and nothing that reads as retryable.
    for (const text of [withBin, codexNoBin]) {
      expect(text).not.toMatch(/adapter|ACP|probe|worktree/i);
      expect(text).not.toMatch(/internal error|process exited|try again|timed out/i);
    }
  });

  it("leaves other failures with the established prefix", () => {
    expect(friendlySessionStartError("claude", "boom", null)).toBe("couldn't start a claude session: boom");
  });
});
