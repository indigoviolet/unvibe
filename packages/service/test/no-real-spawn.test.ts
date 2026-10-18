/**
 * Guard against finding 1 (issue #119): no unit test may start the real
 * `claude`/`codex` adapters or call real `gh`.
 *
 * - `buildApp`/`createApp` without explicit fakes must substitute the
 *   `FakeAgentRunner` + `StaticModelCatalog` and guard the command runner,
 *   never silently fall back to the real ACP runner / `RealCommandRunner`.
 * - `TestCommandGuard` refuses `gh`/`claude`/`codex` loudly.
 * - Tripwire: with recording shims installed as `UNVIBE_CLAUDE_BIN`,
 *   `UNVIBE_CODEX_BIN` and `gh` on PATH, the former worst call
 *   (`GET /api/settings` on a default app) must not execute any of them.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { AcpAgentRunner } from "../src/agent/acp/runner.js";
import { createAgentRunner } from "../src/agent/factory.js";
import { buildApp, isTestProcess } from "../src/app.js";
import { FakeCommandRunner, TestCommandGuard } from "../src/exec/index.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { createApp } from "../src/server.js";
import { StaticModelCatalog } from "../src/settings/index.js";

const authed = { authorization: "Bearer tok" };

const savedEnv = {
  PATH: process.env.PATH,
  UNVIBE_CLAUDE_BIN: process.env.UNVIBE_CLAUDE_BIN,
  UNVIBE_CODEX_BIN: process.env.UNVIBE_CODEX_BIN,
};

afterEach(() => {
  process.env.PATH = savedEnv.PATH;
  if (savedEnv.UNVIBE_CLAUDE_BIN === undefined) delete process.env.UNVIBE_CLAUDE_BIN;
  else process.env.UNVIBE_CLAUDE_BIN = savedEnv.UNVIBE_CLAUDE_BIN;
  if (savedEnv.UNVIBE_CODEX_BIN === undefined) delete process.env.UNVIBE_CODEX_BIN;
  else process.env.UNVIBE_CODEX_BIN = savedEnv.UNVIBE_CODEX_BIN;
});

/** Recording shims for claude/codex/gh; any execution appends to `log`. */
function makeShims(): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "unvibe-spawn-guard-"));
  const log = join(dir, "spawn.log");
  for (const name of ["claude", "codex", "gh"]) {
    const bin = join(dir, name);
    writeFileSync(bin, `#!/bin/sh\necho "$0 $@" >> ${log}\n`);
    chmodSync(bin, 0o755);
  }
  return { dir, log };
}

function spawned(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

describe("no real agents or GitHub in unit tests (#119)", () => {
  it("runs under the test signal", () => {
    expect(isTestProcess()).toBe(true);
  });

  it("buildApp without fakes substitutes the fake runner, static catalog and guarded commands", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const ctx = buildApp({ db });
    expect(ctx.agents).toBeInstanceOf(FakeAgentRunner);
    expect(ctx.models).toBeInstanceOf(StaticModelCatalog);
    expect(ctx.runner).toBeInstanceOf(TestCommandGuard);
  });

  it("explicit injections are never replaced", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const agents = new FakeAgentRunner();
    const models = new StaticModelCatalog();
    const runner = new FakeCommandRunner();
    const ctx = buildApp({ db, agents, models, runner });
    expect(ctx.agents).toBe(agents);
    expect(ctx.models).toBe(models);
    expect(ctx.runner).toBe(runner);
  });

  it("TestCommandGuard refuses gh/claude/codex and delegates everything else", async () => {
    const inner = new FakeCommandRunner();
    inner.enqueue({ cmd: "git", args: ["--version"], stdout: "git version 2.50.0", stderr: "", code: 0 });
    const guard = new TestCommandGuard(inner);
    const git = await guard.run("git", { args: ["--version"] });
    expect(git.stdout).toContain("git version");
    for (const cmd of ["gh", "claude", "codex", "/usr/bin/gh", "/opt/claude"]) {
      await expect(guard.run(cmd, { args: ["auth", "status"] })).rejects.toThrow(/FakeCommandRunner/);
    }
    expect(inner.calls.map((c) => c.cmd)).toEqual(["git"]);
  });

  it("factory throws without the live flag (unset and mistyped UNVIBE_AGENT) (#188)", () => {
    expect(() => createAgentRunner({ env: {} as NodeJS.ProcessEnv })).toThrow(/UNVIBE_ALLOW_LIVE_AGENT/);
    expect(() =>
      createAgentRunner({ env: { UNVIBE_AGENT: "replayy" } as NodeJS.ProcessEnv }),
    ).toThrow(/UNVIBE_ALLOW_LIVE_AGENT/);
    // replay/none never need the flag
    expect(() => createAgentRunner({ env: { UNVIBE_AGENT: "none" } as NodeJS.ProcessEnv })).not.toThrow();
  });

  it("direct AcpAgentRunner construction throws without the flag, passes with a fake (#188)", () => {
    expect(() => new AcpAgentRunner({ env: {} as NodeJS.ProcessEnv })).toThrow(/UNVIBE_ALLOW_LIVE_AGENT/);
    expect(
      () =>
        new AcpAgentRunner({
          env: {} as NodeJS.ProcessEnv,
          factories: { claude: async () => { throw new Error("unused"); } },
        }),
    ).not.toThrow();
  });

  it("GET /api/settings on a default app spawns no claude/codex/gh", async () => {
    const { dir, log } = makeShims();
    process.env.UNVIBE_CLAUDE_BIN = join(dir, "claude");
    process.env.UNVIBE_CODEX_BIN = join(dir, "codex");
    process.env.PATH = `${dir}${process.env.PATH ? `:${process.env.PATH}` : ""}`;
    // A default app: no agents/models/runner injected. Before #119 this
    // call started the real adapters (~2 s of session/new).
    const { app } = await createApp("tok");
    try {
      const res = await app.inject({ method: "GET", url: "/api/settings", headers: authed });
      expect(res.statusCode).toBe(200);
      expect(spawned(log)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
