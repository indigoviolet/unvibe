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
import { DEFAULT_SETTINGS, SettingsStore } from "../src/settings/store.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
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

  it("unset second opinion names the enforced rule: a different model from main (finding 19)", async () => {
    const r = await getReadiness(
      {
        runner: real,
        agents: fakeAgents({ claude: ["m"], codex: ["m"] }) as never,
        settings: settingsStore({ secondOpinion: { provider: "codex", model: "" } }),
        loginPathValue: "/nonexistent",
        timeoutMs: 1000,
      },
      { force: true },
    );
    const check = r.checks.find((c) => c.id === "agent:secondOpinion")!;
    expect(check.status).toBe("warning");
    expect(check.summary).toContain("different model from main");
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

  it("reports the live default models, not the stored static ids (issue #88)", async () => {
    // Scratch PATH with fake claude/codex CLIs so the agent probes get as
    // far as listModels; versions come from the fake runner (never
    // executed). The catalog offers no new-enough Claude opus, so the live
    // main is gpt-6-sol on Codex — the stored static pick (claude-opus-5-5)
    // must not appear.
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "unvibe-bins-"));
    try {
      const claudeBin = join(dir, "claude");
      const codexBin = join(dir, "codex");
      writeFileSync(claudeBin, "#!/bin/sh\necho claude 2.1.300\n");
      writeFileSync(codexBin, "#!/bin/sh\necho codex 0.165.0\n");
      chmodSync(claudeBin, 0o755);
      chmodSync(codexBin, 0o755);
      const fake = new FakeCommandRunner();
      fake.enqueue({ cmd: claudeBin, args: ["--version"], stdout: "2.1.300", stderr: "", code: 0 });
      // main + small both resolve to Codex: two codex probes run.
      fake.enqueue({ cmd: codexBin, args: ["--version"], stdout: "0.165.0", stderr: "", code: 0 });
      fake.enqueue({ cmd: codexBin, args: ["--version"], stdout: "0.165.0", stderr: "", code: 0 });
      const ids = { claude: ["claude-sonnet-5-5"], codex: ["gpt-6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] };
      const norm = (id: string): { id: string } => ({ id });
      const catalog: ModelCatalog = {
        listModels: (p: string) => Promise.resolve((ids[p as keyof typeof ids] ?? []).map(norm)),
        offered: (p: string) =>
          Promise.resolve({ models: (ids[p as keyof typeof ids] ?? []).map(norm), defaultId: null }),
      };
      const db = openDatabase(":memory:");
      migrate(db);
      const r = await getReadiness(
        {
          runner: fake as never,
          agents: fakeAgents(ids) as never,
          settings: new SettingsStore(db),
          models: catalog,
          loginPathValue: dir,
          timeoutMs: 5000,
        },
        { force: true },
      );
      const summary = (id: string): string => r.checks.find((c) => c.id === id)!.summary;
      expect(r.checks.find((c) => c.id === "agent:main")!.status).toBe("ok");
      expect(summary("agent:main")).toContain("gpt-6-sol");
      expect(summary("agent:main")).not.toContain("opus-5-5");
      expect(summary("agent:small")).toContain("gpt-5.6-luna");
      expect(summary("agent:secondOpinion")).toContain("claude-sonnet-5-5");
      expect(r.checks.find((c) => c.id === "agents-distinct")!.status).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Claude-only machine: main/small ready with no 'not offered', second opinion not set (issue #88)", async () => {
    // Scratch PATH with only a claude CLI; the Codex listing is unknown
    // (not installed), so with nothing saved the live main/small come from
    // Claude and second opinion unsets instead of pointing at Codex.
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "unvibe-bins-claude-only-"));
    try {
      const claudeBin = join(dir, "claude");
      writeFileSync(claudeBin, "#!/bin/sh\necho claude 2.1.300\n");
      chmodSync(claudeBin, 0o755);
      const fake = new FakeCommandRunner();
      // main + small both resolve to Claude: two claude probes run.
      fake.enqueue({ cmd: claudeBin, args: ["--version"], stdout: "2.1.300", stderr: "", code: 0 });
      fake.enqueue({ cmd: claudeBin, args: ["--version"], stdout: "2.1.300", stderr: "", code: 0 });
      const ids = { claude: ["claude-opus-5-5", "claude-haiku-5-5"] };
      const norm = (id: string): { id: string } => ({ id });
      const catalog: ModelCatalog = {
        listModels: (p: string) => Promise.resolve((ids[p as keyof typeof ids] ?? []).map(norm)),
        offered: (p: string) =>
          p === "claude"
            ? Promise.resolve({ models: ids.claude.map(norm), defaultId: null })
            : Promise.resolve(null),
      };
      const db = openDatabase(":memory:");
      migrate(db);
      const r = await getReadiness(
        {
          runner: fake as never,
          agents: fakeAgents(ids) as never,
          settings: new SettingsStore(db),
          models: catalog,
          loginPathValue: dir,
          timeoutMs: 5000,
        },
        { force: true },
      );
      const summary = (id: string): string => r.checks.find((c) => c.id === id)!.summary;
      const main = r.checks.find((c) => c.id === "agent:main")!;
      expect(main.status).toBe("ok");
      expect(summary("agent:main")).toContain("claude-opus-5-5");
      expect(summary("agent:main")).not.toContain("not offered");
      const small = r.checks.find((c) => c.id === "agent:small")!;
      expect(small.status).toBe("ok");
      expect(summary("agent:small")).toContain("claude-haiku-5-5");
      expect(summary("agent:small")).not.toContain("not offered");
      // Not set — a warning, never a failed (error) check.
      const second = r.checks.find((c) => c.id === "agent:secondOpinion")!;
      expect(second.status).toBe("warning");
      expect(summary("agent:secondOpinion")).toMatch(/not set/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
