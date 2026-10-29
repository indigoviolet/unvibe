/**
 * Tool discovery (issue #20): every candidate, shim detection, version only
 * from success, skip-broken choice, overrides.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnoseTool, sweepProbeTmp, TOOL_SPECS, enumerateCandidates } from "../src/diagnostics/tools.js";
import { FakeCommandRunner } from "../src/exec/runner.js";

function makeBin(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

describe("enumerateCandidates", () => {
  it("lists every candidate on PATH in order", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-b-"));
    makeBin(a, "codex", "#!/bin/sh\necho 0.162.1\n");
    makeBin(b, "codex", "#!/bin/sh\necho 0.162.1\n");
    const list = enumerateCandidates("codex", `${a}${path.delimiter}${b}`);
    expect(list).toEqual([path.join(a, "codex"), path.join(b, "codex")]);
  });
});

describe("diagnoseTool", () => {
  it("skips a broken shim first and picks the working binary later", async () => {
    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-broken-"));
    const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-good-"));
    const broken = makeBin(brokenDir, "codex", "#!/bin/sh\necho 'mise ERROR: broken shim' >&2\nexit 1\n");
    const good = makeBin(goodDir, "codex", "#!/bin/sh\necho 'codex 0.162.1'\n");
    const fake = new FakeCommandRunner();
    // Broken first: fails; good later: succeeds.
    fake.enqueue({ cmd: broken, args: ["--version"], stdout: "", stderr: "mise ERROR: broken shim (mise 2026.6.11)", code: 1 });
    fake.enqueue({ cmd: good, args: ["--version"], stdout: "codex 0.162.1", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
    const diag = await diagnoseTool(spec, {
      pathValue: `${brokenDir}${path.delimiter}${goodDir}`,
      env: {},
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.candidates.map((c) => c.path)).toEqual([broken, good]);
    expect(diag.candidates[0].runs).toBe(false);
    // Version only from success: broken shim's error text (with mise's
    // version) must NOT become a version.
    expect(diag.candidates[0].version).toBeNull();
    expect(diag.candidates[1].version).toBe("0.162.1");
    expect(diag.chosen).toBe(good);
    expect(diag.chosenReason).toContain("first that runs");
  });

  it("detects mise vs asdf shims and warns on two installs", async () => {
    const miseDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-mise-"));
    const asdfDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-asdf-"));
    // Paths containing manager markers are detected even without content sniff.
    const miseShimDir = path.join(miseDir, ".local", "share", "mise", "shims");
    const asdfShimDir = path.join(asdfDir, ".asdf", "shims");
    fs.mkdirSync(miseShimDir, { recursive: true });
    fs.mkdirSync(asdfShimDir, { recursive: true });
    const miseBin = makeBin(miseShimDir, "claude", "#!/bin/sh\necho 'claude 2.1.296'\n");
    const asdfBin = makeBin(asdfShimDir, "claude", "#!/bin/sh\necho 'claude 2.1.296'\n");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: miseBin, args: ["--version"], stdout: "claude 2.1.296", stderr: "", code: 0 });
    fake.enqueue({ cmd: asdfBin, args: ["--version"], stdout: "claude 2.1.296", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "claude")!;
    const diag = await diagnoseTool(spec, {
      pathValue: `${miseShimDir}${path.delimiter}${asdfShimDir}`,
      env: {},
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.candidates[0].shimManager).toBe("mise");
    expect(diag.candidates[1].shimManager).toBe("asdf");
    expect(diag.warnings.join(" ")).toMatch(/Two installs/);
  });

  it("reports UNVIBE_*_BIN overrides as such", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-override-"));
    const bin = makeBin(dir, "codex", "#!/bin/sh\necho 'codex 0.162.1'\n");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: bin, args: ["--version"], stdout: "codex 0.162.1", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
    const diag = await diagnoseTool(spec, {
      pathValue: "",
      env: { UNVIBE_CODEX_BIN: bin },
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.overrideEnv).toBe("UNVIBE_CODEX_BIN");
    expect(diag.candidates[0].source).toContain("env UNVIBE_CODEX_BIN");
    expect(diag.chosen).toBe(bin);
  });

  it("missing override warns instead of silently falling through", async () => {
    const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
    const diag = await diagnoseTool(spec, {
      pathValue: "",
      env: { UNVIBE_CODEX_BIN: "/nonexistent/codex-xyz" },
      runner: new FakeCommandRunner() as never,
      timeoutMs: 1000,
    });
    expect(diag.candidates[0].kind).toBe("missing-override");
    expect(diag.chosen).toBeNull();
    expect(diag.warnings.join(" ")).toMatch(/missing/);
  });
});

describe("diagnoseTool shim resolution (issue #105)", () => {
  const TRUST_ERR = "mise ERROR Config files in /tmp/wt/.mise.toml are not trusted.\nTrust them with `mise trust`.";

  function shimWorld(tool: "claude" | "codex"): {
    dir: string;
    shim: string;
    real: string;
    miseBin: string;
    pathValue: string;
  } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-resolve-diag-"));
    // Content mentioning mise classifies the candidate as a mise shim.
    const shim = makeBin(dir, tool, "#!/bin/sh\n# fake mise shim\necho untrusted >&2\nexit 1\n");
    const real = makeBin(dir, `${tool}-real`, "#!/bin/sh\necho real\n");
    const miseBin = makeBin(dir, "mise", "#!/bin/sh\nexit 0\n");
    return { dir, shim, real, miseBin, pathValue: dir };
  }

  it("chooses the resolved real path when the shim fails from a review copy", async () => {
    const w = shimWorld("claude");
    const fake = new FakeCommandRunner();
    // 1. shim --version from the worktree-shaped dir: trust failure.
    fake.enqueue({ cmd: w.shim, args: ["--version"], stdout: "", stderr: TRUST_ERR, code: 1 });
    // 2. `mise which` from the neutral dir: the real path.
    fake.enqueue({ cmd: w.miseBin, args: ["which", "claude"], stdout: `${w.real}\n`, stderr: "", code: 0 });
    // 3. real binary --version from the worktree-shaped dir: runs.
    fake.enqueue({ cmd: w.real, args: ["--version"], stdout: "claude 2.1.296", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "claude")!;
    const diag = await diagnoseTool(spec, {
      pathValue: w.pathValue,
      env: {},
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.candidates).toHaveLength(1);
    expect(diag.candidates[0].runs).toBe(false);
    expect(diag.candidates[0].resolvedPath).toBe(w.real);
    expect(diag.chosen).toBe(w.real);
    expect(diag.chosenReason).toContain("resolves to");
    // The shim probe ran from a worktree-shaped directory, the manager
    // lookup from the neutral one.
    expect(fake.calls[0].opts.cwd).not.toBe(os.homedir());
    expect(fake.calls[1].opts.cwd).toBe(os.homedir());
    expect(diag.warnings.join(" ")).toContain(w.real);
  });

  it("reports the trust failure when the manager has no answer", async () => {
    const w = shimWorld("codex");
    const fake = new FakeCommandRunner();
    // Hostile probe fails, but `mise which` finds nothing: the shim is
    // still chosen (it runs outside review copies) — sessions there fail,
    // and the trust error is reported here first.
    fake.enqueue({ cmd: w.shim, args: ["--version"], stdout: "", stderr: TRUST_ERR, code: 1 });
    fake.enqueue({ cmd: w.miseBin, args: ["which", "codex"], stdout: "", stderr: "nope", code: 1 });
    const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
    const diag = await diagnoseTool(spec, {
      pathValue: w.pathValue,
      env: {},
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.candidates[0].resolvedPath).toBeUndefined();
    expect(diag.chosen).toBeNull();
    expect(diag.chosenReason).toContain("none runs");
    expect(diag.candidates[0].stderr).toContain("not trusted");
  });

  it("never resolves explicit overrides", async () => {
    const w = shimWorld("claude");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: w.shim, args: ["--version"], stdout: "claude 2.1.296", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "claude")!;
    const diag = await diagnoseTool(spec, {
      pathValue: w.pathValue,
      env: { UNVIBE_CLAUDE_BIN: w.shim },
      runner: fake as never,
      timeoutMs: 3000,
    });
    expect(diag.chosen).toBe(w.shim);
    expect(diag.candidates[0].resolvedPath).toBeUndefined();
    expect(fake.calls.some((c) => c.cmd === w.miseBin)).toBe(false);
  });
});

describe("probe worktree cleanup (issue #279)", () => {
  function probeDirs(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((e) => e.startsWith("unvibe-probe-"));
  }

  it("diagnoseTool leaves no probe dir behind (os.tmpdir fallback)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-probe-test-"));
    makeBin(dir, "git", "#!/bin/sh\necho 'git version 2.50.0'\n");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: path.join(dir, "git"), args: ["--version"], stdout: "git version 2.50.0", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "git")!;
    const before = new Set(probeDirs());
    try {
      await diagnoseTool(spec, { pathValue: dir, env: {}, runner: fake as never, timeoutMs: 3000 });
      expect(probeDirs().filter((e) => !before.has(e))).toEqual([]);
    } finally {
      // Never pollute the shared tmp even when the assertion fails.
      for (const e of probeDirs().filter((x) => !before.has(x))) {
        fs.rmSync(path.join(os.tmpdir(), e), { recursive: true, force: true });
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("diagnoseTool probes under <dataDir>/tmp and cleans up", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));
    const bindir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-probebin-"));
    makeBin(bindir, "git", "#!/bin/sh\necho 'git version 2.50.0'\n");
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: path.join(bindir, "git"), args: ["--version"], stdout: "git version 2.50.0", stderr: "", code: 0 });
    const spec = TOOL_SPECS.find((s) => s.tool === "git")!;
    try {
      await diagnoseTool(spec, { pathValue: bindir, env: {}, runner: fake as never, timeoutMs: 3000, dataDir });
      const tmp = path.join(dataDir, "tmp");
      const left = fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((e) => e.startsWith("unvibe-probe-")) : [];
      expect(left).toEqual([]);
      // The probe never touches the shared temp dir.
      expect(probeDirs()).toEqual(probeDirs());
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(bindir, { recursive: true, force: true });
    }
  });

  it("sweepProbeTmp removes every probe dir under <dataDir>/tmp", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-sweep-"));
    try {
      const tmp = path.join(dataDir, "tmp");
      fs.mkdirSync(tmp, { recursive: true });
      const old = path.join(tmp, "unvibe-probe-old");
      const fresh = path.join(tmp, "unvibe-probe-new");
      const other = path.join(tmp, "unvibe-other");
      fs.mkdirSync(old);
      fs.mkdirSync(fresh);
      fs.mkdirSync(other);
      fs.writeFileSync(path.join(tmp, "unvibe-probe-file"), "not a dir");
      // Age must not matter: startup runs before this process diagnoses.
      const ancient = new Date(Date.now() - 60 * 60_000);
      fs.utimesSync(old, ancient, ancient);
      const removed = sweepProbeTmp(dataDir);
      expect([...removed].sort()).toEqual([old, fresh].sort());
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(false);
      expect(fs.existsSync(other)).toBe(true);
      expect(fs.existsSync(path.join(tmp, "unvibe-probe-file"))).toBe(true);
      expect(sweepProbeTmp(path.join(dataDir, "missing"))).toEqual([]);
      expect(sweepProbeTmp("")).toEqual([]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
