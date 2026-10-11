/**
 * Default model selection from live adapter lists (PRD §§4.14/12).
 *
 * Captured listings (see `docs/acp-runner.md`, observed 2026-10-10):
 * - Claude (13): `default` (= Opus 5.5), `opus`, `fable`, `sonnet`,
 *   `haiku`, plus dated pins (`claude-opus-4-6` … `claude-fable-5`, …).
 * - Codex (7): `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`,
 *   `gpt-5.6-sol`, `gpt-5.6-terra` (default), `gpt-5.6-luna`.
 */
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { claudeCapabilityScore, selectDefaultModels } from "../src/settings/defaults.js";

const CLAUDE_CAPTURED = [
  "default",
  "opus",
  "fable",
  "sonnet",
  "haiku",
  "claude-opus-4-6",
  "claude-fable-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

const CODEX_CAPTURED = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

describe("selectDefaultModels", () => {
  it("picks opus main, haiku small, and the adapter-default Codex model", () => {
    const picked = selectDefaultModels({
      claude: CLAUDE_CAPTURED,
      codex: CODEX_CAPTURED,
      codexDefault: "gpt-5.6-terra",
    });
    expect(picked.main).toEqual({ provider: "claude", model: "opus" });
    expect(picked.small).toEqual({ provider: "claude", model: "haiku" });
    expect(picked.secondOpinion).toEqual({ provider: "codex", model: "gpt-5.6-terra" });
  });

  it("prefers short family names over dated pins", () => {
    const picked = selectDefaultModels({
      claude: ["claude-haiku-4-5", "claude-opus-4-6", "claude-sonnet-4-5"],
      codex: [],
    });
    expect(picked.main.model).toBe("claude-opus-4-6");
    expect(picked.small.model).toBe("claude-haiku-4-5");
    expect(picked.secondOpinion).toBeNull();
  });

  it("leaves second opinion unset when Codex offers nothing", () => {
    const picked = selectDefaultModels({ claude: ["sonnet", "haiku"], codex: [] });
    expect(picked.main).toEqual({ provider: "claude", model: "sonnet" });
    expect(picked.small).toEqual({ provider: "claude", model: "haiku" });
    expect(picked.secondOpinion).toBeNull();
  });

  it("falls back to the first Codex model when the adapter default is unknown", () => {
    const picked = selectDefaultModels({ claude: ["haiku"], codex: CODEX_CAPTURED });
    expect(picked.main).toEqual({ provider: "claude", model: "haiku" });
    expect(picked.small).toEqual({ provider: "claude", model: "haiku" });
    expect(picked.secondOpinion).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
  });

  it("ignores a stale adapter default that is no longer offered", () => {
    const picked = selectDefaultModels({
      claude: ["sonnet"],
      codex: ["gpt-6-sol"],
      codexDefault: "gpt-5.6-terra",
    });
    expect(picked.secondOpinion).toEqual({ provider: "codex", model: "gpt-6-sol" });
  });

  it("ranks bare default with opus and unknown ids last", () => {
    expect(claudeCapabilityScore("opus")).toBeGreaterThan(claudeCapabilityScore("sonnet"));
    expect(claudeCapabilityScore("sonnet")).toBeGreaterThan(claudeCapabilityScore("haiku"));
    expect(claudeCapabilityScore("fable")).toBeGreaterThan(claudeCapabilityScore("sonnet"));
    expect(claudeCapabilityScore("default")).toBeLessThan(claudeCapabilityScore("opus"));
    expect(claudeCapabilityScore("default")).toBeGreaterThan(claudeCapabilityScore("fable"));
    expect(claudeCapabilityScore("opus")).toBeGreaterThan(claudeCapabilityScore("claude-opus-4-6"));
    expect(claudeCapabilityScore("something-new")).toBe(0);
  });

  it("prefers the opus alias (Opus 5.5) over the dated claude-opus-5 pin (older Opus 5) (#21)", () => {
    // Issue #21 table: `opus` → Opus 5.5 (resolves to claude-opus-5-5),
    // while `claude-opus-5` in the same list is the older Opus 5.
    expect(claudeCapabilityScore("opus")).toBeGreaterThan(claudeCapabilityScore("claude-opus-5"));
    const picked = selectDefaultModels({
      claude: ["claude-opus-5", "opus", "sonnet", "haiku"],
      codex: [],
    });
    expect(picked.main.model).toBe("opus");
    expect(picked.small.model).toBe("haiku");
  });
});

describe("live settings defaults + validation", () => {
  const auth = { authorization: "Bearer tok" };

  /** Stub catalog with live offerings (null = adapter unknown/down). */
  function stubCatalog(
    offered: Record<string, { models: ({ id: string } | string)[]; defaultId: string | null } | null>,
  ): ModelCatalog {
    const norm = (m: { id: string } | string): { id: string } => (typeof m === "string" ? { id: m } : m);
    return {
      listModels: (p: string) => Promise.resolve((offered[p]?.models ?? []).map(norm)),
      offered: (p: string) => {
        const o = offered[p] ?? null;
        if (!o) return Promise.resolve(null);
        return Promise.resolve({ models: o.models.map(norm), defaultId: o.defaultId });
      },
    };
  }

  async function makeApp(catalog: ModelCatalog) {
    const db = openDatabase(":memory:");
    migrate(db);
    return createApp("tok", {
      settings: new SettingsStore(db),
      models: catalog,
      jobs: new JobQueue(),
      autoPipeline: false,
    });
  }

  it("GET fills never-saved roles from live lists; PUT rejects unoffered models", async () => {
    const { app } = await makeApp(
      stubCatalog({
        claude: { models: ["opus", "sonnet", "haiku"], defaultId: "opus" },
        codex: { models: ["gpt-6-sol", "gpt-5.6-terra"], defaultId: "gpt-5.6-terra" },
      }),
    );
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      expect(get.statusCode).toBe(200);
      const body = get.json() as { main: { model: string }; small: { model: string }; secondOpinion: { model: string } };
      expect(body.main.model).toBe("opus");
      expect(body.small.model).toBe("haiku");
      expect(body.secondOpinion.model).toBe("gpt-5.6-terra");

      const bad = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { main: { provider: "claude", model: "opus-9" } },
      });
      expect(bad.statusCode).toBe(400);
      expect(JSON.stringify(bad.json())).toContain("not offered");

      const ok = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { main: { provider: "claude", model: "sonnet" } },
      });
      expect(ok.statusCode).toBe(200);

      // Saved roles stick even when the live list changes.
      const again = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      expect((again.json() as typeof body).main.model).toBe("sonnet");
      expect((again.json() as typeof body).small.model).toBe("haiku");
    } finally {
      await app.close();
    }
  });

  it("GET leaves second opinion unset when Codex offers nothing", async () => {
    const { app } = await makeApp(
      stubCatalog({
        claude: { models: ["sonnet", "haiku"], defaultId: null },
        codex: { models: [], defaultId: null },
      }),
    );
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      const body = get.json() as { secondOpinion: { provider: string; model: string } };
      expect(body.secondOpinion).toEqual({ provider: "codex", model: "" });

      // Unsetting explicitly is valid; empty main is not.
      const unset = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { secondOpinion: { provider: "codex", model: "" } },
      });
      expect(unset.statusCode).toBe(200);
      const badMain = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { main: { provider: "claude", model: "" } },
      });
      expect(badMain.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("GET keeps static defaults when offerings are unknown", async () => {
    const { app } = await makeApp(stubCatalog({}));
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      const body = get.json() as { main: { model: string }; secondOpinion: { model: string } };
      expect(body.main.model).toBe("claude-sonnet");
      expect(body.secondOpinion.model).toBe("gpt-5.4");
    } finally {
      await app.close();
    }
  });
});
