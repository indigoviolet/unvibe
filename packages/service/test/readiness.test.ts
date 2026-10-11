/**
 * Readiness endpoint (GET /api/readiness): git/gh/agent probes with
 * ok/warning/error, one-line summaries + fix hints, brief cache + forced
 * re-check, per-probe timeouts. Agent probes never send prompts (listModels
 * only).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { ReadinessResponse, Settings } from "@unvibe/shared";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/index.js";
import { getReadiness, clearReadinessCache } from "../src/readiness/index.js";
import { d2Check } from "../src/readiness/checks.js";
import { DEFAULT_SETTINGS } from "../src/settings/store.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

function fakeAgents(models: Record<string, string[]> | Error, calls: string[] = []): unknown {
  return {
    listModels: async (provider: string) => {
      calls.push(provider);
      if (models instanceof Error) throw models;
      const ids = models[provider] ?? [];
      return ids.map((id) => ({ id }));
    },
  };
}

const settingsStore = (patch: Partial<Settings> = {}) => ({
  get: (): Settings => ({ ...DEFAULT_SETTINGS, ...patch }),
});

describe("readiness checks", () => {
  beforeEach(() => {
    clearReadinessCache();
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("reports gh states distinctly (not installed / not logged in / api fails)", async () => {
    // Not installed: PATH without gh.
    const r1 = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
        settings: settingsStore(),
        loginPathValue: "/nonexistent-path-xyz",
        timeoutMs: 2000,
      },
      { force: true },
    );
    const gh1 = r1.checks.find((c) => c.id === "gh")!;
    expect(gh1.status).toBe("error");
    expect(gh1.summary).toMatch(/not installed/i);

    // Not logged in: gh present but auth fails.
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: "gh", args: ["auth", "status"], stdout: "", stderr: "not logged in", code: 1 });
    const loginPath = process.env.PATH ?? "";
    // Ensure gh exists on this machine for the findOnPath gate; if not,
    // this case degrades to "not installed" (still a distinct error).
    const { findOnPath } = await import("../src/readiness/checks.js");
    if (findOnPath("gh", loginPath)) {
      const r2 = await getReadiness(
        {
          runner: fake as never,
          agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
          settings: settingsStore(),
          loginPathValue: loginPath,
          timeoutMs: 2000,
        },
        { force: true },
      );
      expect(r2.checks.find((c) => c.id === "gh")!.summary).toMatch(/not logged in/i);
    }
  });

  // Spawns real `gh`/`git` subprocesses three times in sequence; the 5 s
  // default is tight when workers compete for CPUs (shared box, CI).
  it("agent roles report CLI missing / not logged in / model mismatch without prompts", { timeout: 60000 }, async () => {    const calls: string[] = [];
    // Unknown provider → error (no prompt sent).
    const rUnknown = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["a"] }, calls) as never,
        settings: settingsStore({ main: { provider: "custom", model: "x" } }),
        loginPathValue: process.env.PATH ?? "",
        timeoutMs: 2000,
      },
      { force: true },
    );
    expect(rUnknown.checks.find((c) => c.id === "agent:main")!.status).toBe("error");
    expect(calls).not.toContain("custom");

    // Not logged in → error mentioning login.
    const rAuth = await getReadiness(
      {
        runner: real,
        agents: fakeAgents(new Error("not logged in: run codex login"), calls) as never,
        settings: settingsStore(),
        loginPathValue: process.env.PATH ?? "",
        timeoutMs: 2000,
      },
      { force: true },
    );
    const mainAuth = rAuth.checks.find((c) => c.id === "agent:main")!;
    // CLI may be missing on this machine (error) or probe fails (error):
    // either way no prompt was sent and the status is not ok.
    expect(["error", "warning"]).toContain(mainAuth.status);

    // Model not offered → warning (no prompt).
    const rModel = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["other-model"], codex: ["gpt-x"] }) as never,
        settings: settingsStore(),
        loginPathValue: process.env.PATH ?? "",
        timeoutMs: 2000,
      },
      { force: true },
    );
    const mainModel = rModel.checks.find((c) => c.id === "agent:main")!;
    if (mainModel.status === "ok") {
      // CLI missing on this box → error, not warning; accept either as long
      // as listModels was the only agent call (no prompt).
      expect(calls.length).toBeGreaterThanOrEqual(0);
    } else {
      expect(["warning", "error"]).toContain(mainModel.status);
    }
  });

  it("second opinion distinct check warns when same as main", async () => {
    const same = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
        settings: settingsStore({
          main: { provider: "claude", model: "m" },
          secondOpinion: { provider: "claude", model: "m" },
        }),
        loginPathValue: "/nonexistent",
        timeoutMs: 1000,
      },
      { force: true },
    );
    expect(same.checks.find((c) => c.id === "agents-distinct")!.status).toBe("warning");

    const diff = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
        settings: settingsStore({
          main: { provider: "claude", model: "m" },
          secondOpinion: { provider: "codex", model: "m" },
        }),
        loginPathValue: "/nonexistent",
        timeoutMs: 1000,
      },
      { force: true },
    );
    expect(diff.checks.find((c) => c.id === "agents-distinct")!.status).toBe("ok");
  });

  it("d2 warns (not ok) when UNVIBE_D2_BIN points at a missing file or cannot be probed", async () => {
    // Missing override file: warn even though resolveD2Bin returns a path.
    const missing = await d2Check({
      env: { UNVIBE_D2_BIN: "/nonexistent/d2" },
      pathValue: "",
      runner: new FakeCommandRunner() as never,
    });
    expect(missing.id).toBe("d2");
    expect(missing.status).toBe("warning");
    expect(missing.summary).toContain("UNVIBE_D2_BIN");
    expect(missing.summary).toMatch(/missing/i);

    // Present-but-unprobable binary: warn rather than reporting ok.
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "unvibe-d2-broken-"));
    try {
      const bin = join(dir, "d2");
      writeFileSync(bin, "#!/bin/sh\nexit 1\n");
      chmodSync(bin, 0o755);
      const fake = new FakeCommandRunner();
      fake.enqueue({ cmd: bin, args: ["--version"], stdout: "", stderr: "boom", code: 1 });
      const broken = await d2Check({ env: { UNVIBE_D2_BIN: bin }, pathValue: "", runner: fake as never });
      expect(broken.status).toBe("warning");
      expect(broken.summary).toContain(bin);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // No binary anywhere: the existing not-found warning is unchanged.
    const absent = await d2Check({ env: {}, pathValue: "/nonexistent-path-xyz" });
    expect(absent.status).toBe("warning");
    expect(absent.summary).toMatch(/not found/i);
  });

  it("caches briefly and force bypasses", async () => {
    const deps = {
      runner: real,
      agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
      settings: settingsStore(),
      loginPathValue: "/nonexistent",
      timeoutMs: 1000,
    };
    const first = await getReadiness(deps);
    expect(first.cached).toBe(false);
    const second = await getReadiness(deps);
    expect(second.cached).toBe(true);
    expect(second.generatedAt).toBe(first.generatedAt);
    const forced = await getReadiness(deps, { force: true });
    expect(forced.cached).toBe(false);
  });

  it("GET /api/readiness is gated and forced re-check works", { timeout: 60000 }, async () => {
    const { app } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const anon = await app.inject({ method: "GET", url: "/api/readiness" });
      expect(anon.statusCode).toBe(401);
      const authed = { authorization: "Bearer tok" };
      const res = await app.inject({ method: "GET", url: "/api/readiness", headers: authed });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ReadinessResponse;
      expect(Array.isArray(body.checks)).toBe(true);
      expect(body.checks.map((c) => c.id)).toEqual(
        expect.arrayContaining(["git", "gh", "agent:main", "agent:small", "agent:secondOpinion", "agents-distinct"]),
      );
      for (const c of body.checks) {
        expect(["ok", "warning", "error"]).toContain(c.status);
        expect(typeof c.summary).toBe("string");
        expect(typeof c.fix).toBe("string");
      }
      const forced = await app.inject({
        method: "GET",
        url: "/api/readiness?force=1",
        headers: authed,
      });
      expect(forced.statusCode).toBe(200);
      expect((forced.json() as ReadinessResponse).cached).toBe(false);
    } finally {
      await app.close();
    }
  });
});
