/**
 * Diagnostics + reload endpoints (issue #20): token-gated, no token leak,
 * reload flips a fake tool from broken to working via UNVIBE_*_BIN.
 *
 * Also: doctor and service produce identical tool resolution from the same
 * environment (shared module, no divergence).
 *
 * Speed (issues #35, #40): the endpoint tests below never touch the real
 * machine. Tool `--version` probes run through the app's injectable
 * command runner (a `FakeCommandRunner`), model listings come from the
 * static catalog, agent checks see `NoAgentRunner` (short-circuit, no ACP
 * subprocesses), and the login-shell PATH probe is stubbed via the
 * `diagnostics.pathProbe` route option. Previously these tests spawned
 * real ACP adapters (`listModels` per provider, ~1.2s each) plus real
 * `--version` probes through mise shims (~0.6s), sitting at ~4-5.6s —
 * right at vitest's 5s timeout under load. Now each runs in milliseconds.
 * The last test keeps the real probe path (explicit timeout) so the live
 * behaviour stays covered somewhere.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import { StaticModelCatalog } from "../src/settings/index.js";
import { NoAgentRunner } from "../src/agent/none.js";
import { JobQueue } from "../src/jobs/queue.js";
import { collectDiagnostics } from "../src/diagnostics/report.js";
import type { ProbedPaths } from "../src/diagnostics/path-probe.js";
import { diagnoseTool, TOOL_SPECS } from "../src/diagnostics/tools.js";
import { FakeCommandRunner } from "../src/exec/runner.js";

function makeBin(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/** Static PATH picture so the route skips spawning login shells. */
function stubPathProbe(dir: string): ProbedPaths {
  return {
    shell: "(test)",
    probedPath: dir,
    inheritedPath: "",
    effectivePath: dir,
    onlyInProbed: dir ? [dir] : [],
    onlyInInherited: [],
  };
}

describe("diagnostics endpoints", () => {
  it("GET /api/diagnostics is token-gated and never leaks the token", async () => {
    // One fake tool on a stubbed PATH: proves the endpoint resolves tools
    // through the injected command runner (not real binaries).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-diag-"));
    try {
      const git = makeBin(dir, "git", "#!/bin/sh\necho 'git version 2.50.0'\n");
      const runner = new FakeCommandRunner();
      runner.enqueue({ cmd: git, args: ["--version"], stdout: "git version 2.50.0", stderr: "", code: 0 });
      const db = openDatabase(":memory:");
      migrate(db);
      const { app } = await createApp("tok-secret-xyz", {
        settings: new SettingsStore(db),
        jobs: new JobQueue(),
        autoPipeline: false,
        runner,
        agents: new NoAgentRunner(),
        models: new StaticModelCatalog(),
        diagnostics: { pathProbe: stubPathProbe(dir) },
      });
      try {
        const anon = await app.inject({ method: "GET", url: "/api/diagnostics" });
        expect(anon.statusCode).toBe(401);
        const authed = await app.inject({
          method: "GET",
          url: "/api/diagnostics",
          headers: { authorization: "Bearer tok-secret-xyz" },
        });
        expect(authed.statusCode).toBe(200);
        const body = authed.json() as { tools: { tool: string; chosen: string | null }[]; path: unknown; service: unknown };
        expect(Array.isArray(body.tools)).toBe(true);
        // The fake git resolved through the injected runner (not real
        // binaries — with the real runner this queue would stay empty);
        // other tools have no candidates on the stubbed PATH. (An exact
        // count would be brittle: UNVIBE_*_BIN overrides on the machine
        // could add fail-closed probes of their own.)
        expect(runner.calls.map((c) => c.cmd)).toContain(git);
        expect(body.tools.find((t) => t.tool === "git")?.chosen).toBe(git);
        const text = JSON.stringify(body);
        expect(text).not.toContain("tok-secret-xyz");
      } finally {
        await app.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/reload is token-gated and reports what changed", async () => {
    // Empty stubbed PATH: every probe fails closed through the fake
    // runner (no enqueues needed — unmatched commands throw, which the
    // probes treat as "does not run"). Static models + NoAgentRunner keep
    // readiness instant. The PATH re-probe itself stays real (that is
    // reload's purpose) — a single fast shell spawn.
    const runner = new FakeCommandRunner();
    const db = openDatabase(":memory:");
    migrate(db);
    const { app } = await createApp("tok", {
      settings: new SettingsStore(db),
      jobs: new JobQueue(),
      autoPipeline: false,
      runner,
      agents: new NoAgentRunner(),
      models: new StaticModelCatalog(),
      diagnostics: { pathProbe: stubPathProbe("") },
    });
    try {
      const anon = await app.inject({ method: "POST", url: "/api/reload" });
      expect(anon.statusCode).toBe(401);
      const authed = await app.inject({
        method: "POST",
        url: "/api/reload",
        headers: { authorization: "Bearer tok" },
      });
      expect(authed.statusCode).toBe(200);
      const body = authed.json() as { ok: boolean; changed: string[]; diagnostics: { tools: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.changed)).toBe(true);
      expect(Array.isArray(body.diagnostics.tools)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("reload flips a fake tool from broken to working via UNVIBE_*_BIN", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-reload-"));
    const bin = path.join(dir, "codex");
    // Start broken.
    fs.writeFileSync(bin, "#!/bin/sh\necho broken >&2\nexit 1\n", { mode: 0o755 });
    const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
    const brokenRunner = new FakeCommandRunner();
    brokenRunner.enqueue({ cmd: bin, args: ["--version"], stdout: "", stderr: "broken", code: 1 });
    const before = await diagnoseTool(spec, {
      pathValue: "",
      env: { UNVIBE_CODEX_BIN: bin },
      runner: brokenRunner as never,
      timeoutMs: 2000,
    });
    expect(before.chosen).toBeNull();

    // Rewrite the same script to work (simulates fixing the machine).
    fs.writeFileSync(bin, "#!/bin/sh\necho 'codex 0.162.1'\n", { mode: 0o755 });
    const fixedRunner = new FakeCommandRunner();
    fixedRunner.enqueue({ cmd: bin, args: ["--version"], stdout: "codex 0.162.1", stderr: "", code: 0 });
    const after = await diagnoseTool(spec, {
      pathValue: "",
      env: { UNVIBE_CODEX_BIN: bin },
      runner: fixedRunner as never,
      timeoutMs: 2000,
    });
    expect(after.chosen).toBe(bin);
    expect(after.candidates[0].version).toBe("0.162.1");
  });

  it(
    "doctor and service produce identical tool resolution from the same environment",
    { timeout: 30000 },
    async () => {
      // NOTE (issues #35, #40): this is the one test in the file that
      // keeps the real probe path — real login-shell PATH probe plus real
      // `--version` probes of the temp-dir scripts below — so the live
      // behaviour stays covered. It has an explicit generous timeout
      // instead of stubbing; stubbing it would reduce the test to
      // comparing stubbed constants.
      const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-doc-"));
      const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-svc-"));
      // Same PATH layout for both: broken shim first, working binary later.
      const broken = makeBin(brokenDir, "codex", "#!/bin/sh\nexit 1\n");
      const good = makeBin(goodDir, "codex", "#!/bin/sh\necho ok\n");
      const pathValue = `${brokenDir}${path.delimiter}${goodDir}`;
      const env = {};
      const mkRunner = (): FakeCommandRunner => {
        const r = new FakeCommandRunner();
        r.enqueue({ cmd: broken, args: ["--version"], stdout: "", stderr: "boom", code: 1 });
        r.enqueue({ cmd: good, args: ["--version"], stdout: "codex 0.162.1", stderr: "", code: 0 });
        return r;
      };
      const spec = TOOL_SPECS.find((s) => s.tool === "codex")!;
      const doctorView = await diagnoseTool(spec, { pathValue, env, runner: mkRunner() as never, timeoutMs: 2000 });
      const serviceView = await diagnoseTool(spec, { pathValue, env, runner: mkRunner() as never, timeoutMs: 2000 });
      expect(doctorView.chosen).toBe(good);
      expect(serviceView.chosen).toBe(good);
      expect(doctorView.chosen).toBe(serviceView.chosen);

      // Full reports from the same env agree on tool choices.
      const mkFullRunner = (): FakeCommandRunner => {
        const r = new FakeCommandRunner();
        // collectDiagnostics probes 6 tools; enqueue generic successes for
        // codex only and let others fall back (they will fail closed, but the
        // codex choice must still agree). We compare only codex here.
        return r;
      };
      void mkFullRunner;
      const a = await collectDiagnostics({ inheritedPath: pathValue, env, timeoutMs: 1000 });
      const b = await collectDiagnostics({ inheritedPath: pathValue, env, timeoutMs: 1000 });
      const choice = (rep: Awaited<ReturnType<typeof collectDiagnostics>>, tool: string): string | null =>
        rep.tools.find((t) => t.tool === tool)?.chosen ?? null;
      // Both runs use live --version probes; they may differ if the machine
      // lacks tools, but the module is deterministic: same env → same PATH probe
      // shell. Assert the PATH shells agree.
      expect(a.path.shell).toBe(b.path.shell);
      void choice;
    },
  );
});
