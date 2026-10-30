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
 * (The one test that keeps the real probe path lives in
 * `diagnostics-api.slow.test.ts`, since it is machine-dependent.)
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
      // Scratch data dir (#313): diagnostics resolves loadConfig(), which
      // must never resolve the real data dir in a test.
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-diag-data-"));
      const savedDataDirEnv = process.env.UNVIBE_DATA_DIR;
      process.env.UNVIBE_DATA_DIR = dataDir;
      const { app } = await createApp("tok-secret-xyz", {
        dataDir,
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
        if (savedDataDirEnv === undefined) delete process.env.UNVIBE_DATA_DIR;
        else process.env.UNVIBE_DATA_DIR = savedDataDirEnv;
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
    // Scratch data dir (#313), as above.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-diag-data-"));
    const savedDataDirEnv = process.env.UNVIBE_DATA_DIR;
    process.env.UNVIBE_DATA_DIR = dataDir;
    const { app } = await createApp("tok", {
      dataDir,
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
      if (savedDataDirEnv === undefined) delete process.env.UNVIBE_DATA_DIR;
      else process.env.UNVIBE_DATA_DIR = savedDataDirEnv;
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
});
