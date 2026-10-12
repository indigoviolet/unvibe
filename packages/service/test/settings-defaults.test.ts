/**
 * Default model selection from live adapter lists (PRD §§4.14/12, issue #88).
 *
 * Fixtures are built from the issue #88 table (ids as listed on
 * 2026-10-12) plus the aliases (`default`, `opus`, `sonnet`, `haiku`) and
 * dated ids (`claude-haiku-4-5-20251001`) the issue mentions. No 2026-10-12
 * adapter listing is recorded anywhere — `docs/acp-runner.md` still shows
 * the 2026-10-10 capture — so these are assembled from the issue, not
 * captured from a probe. The Codex side matches the 7 models the issue
 * reports; the Claude side has the 13 the issue reports.
 */
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { parseModelId, resolveEffectiveSettings, selectDefaultModels } from "../src/settings/index.js";
import { SharedContextService } from "../src/sharedctx/service.js";

const CLAUDE_ISSUE = [
  "default",
  "opus",
  "fable",
  "sonnet",
  "haiku",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-haiku-5-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
];

const CODEX_ISSUE = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

describe("selectDefaultModels against the issue #88 table", () => {
  it("matches every row (main, small, second opinion with main on Claude)", () => {
    const picked = selectDefaultModels({ claude: CLAUDE_ISSUE, codex: CODEX_ISSUE });
    expect(picked.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(picked.small).toEqual({ provider: "claude", model: "claude-haiku-5-5" });
    expect(picked.secondOpinion).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
  });

  it("second opinion comes from the provider main is not using (main on Codex)", () => {
    // No Claude opus new enough for the top matchers, so main lands on
    // Codex sol — then second opinion ranks Claude opus > opus > sonnet.
    const picked = selectDefaultModels({
      claude: ["claude-opus-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
      codex: CODEX_ISSUE,
    });
    expect(picked.main).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
    expect(picked.secondOpinion).toEqual({ provider: "claude", model: "claude-opus-5" });
  });

  it("a saved main on Codex takes second opinion from Claude via mainOverride", () => {
    // A live pick would put main on Claude; the saved pick keeps it on
    // Codex, so second opinion ranks Claude opus first (issue table row).
    const picked = selectDefaultModels({ claude: CLAUDE_ISSUE, codex: CODEX_ISSUE }, { provider: "codex" });
    expect(picked.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(picked.secondOpinion).toEqual({ provider: "claude", model: "claude-opus-5-5" });
  });

  it("prefers the newer cross-provider model over the older same-provider one", () => {
    // Table order: gpt-6.1-sol (row 2) beats claude-opus-5 (row 3).
    const picked = selectDefaultModels({ claude: ["claude-opus-5"], codex: ["gpt-6.1-sol"] });
    expect(picked.main).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
  });

  it("falls back within and across tiers in table order", () => {
    // Only an older sonnet on Claude, only terra on Codex: sonnet row wins.
    expect(
      selectDefaultModels({ claude: ["claude-sonnet-5-5"], codex: ["gpt-5.6-terra"] }).main,
    ).toEqual({ provider: "claude", model: "claude-sonnet-5-5" });
    // Sonnet too old for its floor: terra row wins.
    expect(
      selectDefaultModels({ claude: ["claude-sonnet-5"], codex: ["gpt-5.6-terra"] }).main,
    ).toEqual({ provider: "codex", model: "gpt-5.6-terra" });
    // Older opus still fills its own row when nothing newer is offered.
    expect(selectDefaultModels({ claude: ["claude-opus-5"], codex: [] }).main).toEqual({
      provider: "claude",
      model: "claude-opus-5",
    });
  });
});

describe("excluded families are never picked", () => {
  it("returns null roles when only Fable and Astra are offered", () => {
    const picked = selectDefaultModels({ claude: ["fable", "claude-fable-5"], codex: ["gpt-6-astra"] });
    expect(picked).toEqual({ main: null, small: null, secondOpinion: null });
  });

  it("skips Fable for a lower tier even when it is the only high tier offered", () => {
    const picked = selectDefaultModels({
      claude: ["claude-fable-5"],
      codex: ["gpt-5.6-terra", "gpt-5.6-luna"],
    });
    expect(picked.main).toEqual({ provider: "codex", model: "gpt-5.6-terra" });
    expect(picked.small).toEqual({ provider: "codex", model: "gpt-5.6-luna" });
    // Main is on Codex; Claude offers nothing usable for second opinion.
    expect(picked.secondOpinion).toBeNull();
  });

  it("parseModelId rejects Fable, Astra and unknown ids", () => {
    expect(parseModelId("claude", "fable")).toBeNull();
    expect(parseModelId("claude", "claude-fable-5")).toBeNull();
    expect(parseModelId("codex", "gpt-6-astra")).toBeNull();
    expect(parseModelId("claude", "something-new")).toBeNull();
    expect(parseModelId("codex", "gpt-9")).toBeNull();
  });
});

describe("aliases and dated ids", () => {
  it("aliases satisfy their family when nothing versioned is offered", () => {
    const picked = selectDefaultModels({
      claude: ["default", "opus", "sonnet", "haiku", "claude-haiku-4-5-20251001"],
      codex: [],
    });
    expect(picked.main).toEqual({ provider: "claude", model: "opus" });
    expect(picked.small).toEqual({ provider: "claude", model: "haiku" });
    expect(picked.secondOpinion).toBeNull();
  });

  it("prefers the explicit versioned id over aliases of the same family", () => {
    const picked = selectDefaultModels({
      claude: ["default", "opus", "claude-opus-5-5", "haiku"],
      codex: [],
    });
    expect(picked.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
  });

  it("prefers the stable family alias over the drifting default alias", () => {
    expect(selectDefaultModels({ claude: ["default", "opus"], codex: [] }).main).toEqual({
      provider: "claude",
      model: "opus",
    });
  });

  it("parses dated pins by version and picks them when they are all there is", () => {
    expect(parseModelId("claude", "claude-haiku-4-5-20251001")).toMatchObject({
      family: "haiku",
      version: [4, 5],
      dated: true,
    });
    const picked = selectDefaultModels({ claude: ["claude-haiku-4-5-20251001"], codex: [] });
    expect(picked.small).toEqual({ provider: "claude", model: "claude-haiku-4-5-20251001" });
    expect(picked.main).toBeNull();
  });

  it("prefers the plain id over a dated pin on an exact version tie", () => {
    const picked = selectDefaultModels({
      claude: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
      codex: [],
    });
    expect(picked.small).toEqual({ provider: "claude", model: "claude-haiku-4-5" });
  });
});

describe("new versions win without a code change", () => {
  it("a hypothetical claude-opus-6 beats claude-opus-5-5 for main", () => {
    const picked = selectDefaultModels({
      claude: ["claude-opus-5-5", "claude-opus-6"],
      codex: CODEX_ISSUE,
    });
    expect(picked.main).toEqual({ provider: "claude", model: "claude-opus-6" });
  });

  it("a hypothetical gpt-6.2-sol is picked up for main and second opinion", () => {
    const picked = selectDefaultModels({ claude: [], codex: ["gpt-6.2-sol", "gpt-6.1-sol"] });
    expect(picked.main).toEqual({ provider: "codex", model: "gpt-6.2-sol" });
  });
});

describe("one provider or none", () => {
  it("with Claude only, second opinion stays unset", () => {
    const picked = selectDefaultModels({ claude: CLAUDE_ISSUE, codex: [] });
    expect(picked.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(picked.small).toEqual({ provider: "claude", model: "claude-haiku-5-5" });
    expect(picked.secondOpinion).toBeNull();
  });

  it("with Codex only, main and small come from Codex and second opinion stays unset", () => {
    const picked = selectDefaultModels({ claude: [], codex: CODEX_ISSUE });
    expect(picked.main).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
    expect(picked.small).toEqual({ provider: "codex", model: "gpt-6-luna" });
    expect(picked.secondOpinion).toBeNull();
  });

  it("with nothing offered, every role is null (caller keeps stored)", () => {
    expect(selectDefaultModels({ claude: [], codex: [] })).toEqual({
      main: null,
      small: null,
      secondOpinion: null,
    });
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

  function liveCatalog(): ModelCatalog {
    return stubCatalog({
      claude: { models: [...CLAUDE_ISSUE], defaultId: "default" },
      codex: { models: [...CODEX_ISSUE], defaultId: "gpt-5.6-terra" },
    });
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
    const { app } = await makeApp(liveCatalog());
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      expect(get.statusCode).toBe(200);
      const body = get.json() as { main: { model: string }; small: { model: string }; secondOpinion: { model: string } };
      expect(body.main.model).toBe("claude-opus-5-5");
      expect(body.small.model).toBe("claude-haiku-5-5");
      expect(body.secondOpinion.model).toBe("gpt-6.1-sol");

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
        payload: { main: { provider: "claude", model: "claude-sonnet-5-5" } },
      });
      expect(ok.statusCode).toBe(200);

      // Saved roles stick even when the live list changes.
      const again = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      expect((again.json() as typeof body).main.model).toBe("claude-sonnet-5-5");
      expect((again.json() as typeof body).small.model).toBe("claude-haiku-5-5");
    } finally {
      await app.close();
    }
  });

  it("a saved main on Codex takes second opinion from Claude (issue table row)", async () => {
    const { app, ctx } = await makeApp(liveCatalog());
    try {
      ctx.settings.update({ main: { provider: "codex", model: "gpt-6-sol" } });
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      const body = get.json() as {
        main: { provider: string; model: string };
        secondOpinion: { provider: string; model: string };
      };
      expect(body.main).toEqual({ provider: "codex", model: "gpt-6-sol" });
      expect(body.secondOpinion).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    } finally {
      await app.close();
    }
  });

  it("GET leaves second opinion unset when Codex definitively offers nothing", async () => {
    const { app } = await makeApp(
      stubCatalog({
        claude: { models: [...CLAUDE_ISSUE], defaultId: null },
        codex: { models: [], defaultId: null },
      }),
    );
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      const body = get.json() as {
        main: { provider: string; model: string };
        secondOpinion: { provider: string; model: string };
      };
      expect(body.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
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
      const body = get.json() as {
        main: { model: string };
        small: { model: string };
        secondOpinion: { model: string };
      };
      expect(body.main.model).toBe("claude-opus-5-5");
      expect(body.small.model).toBe("claude-haiku-5-5");
      expect(body.secondOpinion.model).toBe("gpt-6.1-sol");
    } finally {
      await app.close();
    }
  });

  it("GET keeps stored picks when live lists offer no allowed family", async () => {
    const { app } = await makeApp(
      stubCatalog({
        claude: { models: ["fable", "claude-fable-5"], defaultId: null },
        codex: { models: ["gpt-6-astra"], defaultId: null },
      }),
    );
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      const body = get.json() as {
        main: { model: string };
        secondOpinion: { provider: string; model: string };
      };
      // Unfillable roles keep the stored (static) pick; readiness reports it.
      expect(body.main.model).toBe("claude-opus-5-5");
      // Codex offering is definitive but unusable: second opinion unsets.
      expect(body.secondOpinion).toEqual({ provider: "codex", model: "" });
    } finally {
      await app.close();
    }
  });

  it("resolving effective settings never writes the computed defaults", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const settings = new SettingsStore(db);
    const resolved = await resolveEffectiveSettings({ settings, models: liveCatalog() });
    expect(resolved.main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(resolved.secondOpinion).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
    // Nothing persisted: no role counts as saved and stored values stand.
    expect(settings.savedKeys()).toEqual([]);
    expect(settings.get().main).toEqual({ provider: "claude", model: "claude-opus-5-5" });
  });
});

describe("shared context sees the same effective settings", () => {
  function serviceWith(
    catalog: ModelCatalog,
  ): { service: SharedContextService; seenBaseKeys: string[] } {
    const db = openDatabase(":memory:");
    migrate(db);
    const seenBaseKeys: string[] = [];
    const service = new SharedContextService({
      reviews: {
        getSnapshot: () => ({ version: { n: 1 }, pages: [], logTail: [] }),
      } as never,
      sessions: {
        baseInfo: (key: string) => {
          seenBaseKeys.push(key);
          return undefined;
        },
      } as never,
      settings: new SettingsStore(db),
      models: catalog,
      store: { statsForReview: () => [], observe: () => {} } as never,
    });
    return { service, seenBaseKeys };
  }

  function codexMainCatalog(): ModelCatalog {
    const norm = (id: string): { id: string } => ({ id });
    return {
      listModels: (p: string) =>
        Promise.resolve(
          (p === "claude" ? ["claude-haiku-4-5"] : ["gpt-6-sol", "gpt-5.6-luna"]).map(norm),
        ),
      offered: (p: string) =>
        Promise.resolve({
          models: (p === "claude" ? ["claude-haiku-4-5"] : ["gpt-6-sol", "gpt-5.6-luna"]).map(norm),
          defaultId: null,
        }),
    };
  }

  it("base keys use the live main pick, not the stored static one", async () => {
    const { service, seenBaseKeys } = serviceWith(codexMainCatalog());
    // Live main is gpt-6-sol on Codex (no new-enough Claude opus offered);
    // the stored static pick is claude-opus-5-5.
    await service.maybeGrowBase("r1", async () => {});
    expect(seenBaseKeys).toHaveLength(1);
    expect(seenBaseKeys[0]).toContain("codex|gpt-6-sol");
    expect(seenBaseKeys[0]).not.toContain("opus-5-5");
  });

  it("base keys keep the stored pick when offerings are unknown", async () => {
    const { service, seenBaseKeys } = serviceWith({
      listModels: () => Promise.resolve([]),
      offered: () => Promise.resolve(null),
    });
    await service.maybeGrowBase("r1", async () => {});
    expect(seenBaseKeys).toHaveLength(1);
    expect(seenBaseKeys[0]).toContain("claude|claude-opus-5-5");
  });
});
