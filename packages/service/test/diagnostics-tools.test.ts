/**
 * Tool discovery (issue #20): every candidate, shim detection, version only
 * from success, skip-broken choice, overrides.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnoseTool, TOOL_SPECS, enumerateCandidates } from "../src/diagnostics/tools.js";
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
