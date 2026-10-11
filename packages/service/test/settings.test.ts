/**
 * Settings + jobs/settings route tests (PRD §4.14, §14.1).
 */
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";
import { DEFAULT_SETTINGS, SettingsStore, StaticModelCatalog } from "../src/settings/index.js";

function makeStore(): SettingsStore {
  const db = openDatabase(":memory:");
  migrate(db);
  return new SettingsStore(db);
}

describe("SettingsStore", () => {
  it("returns defaults when nothing is stored", () => {
    expect(makeStore().get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists partial updates", () => {
    const store = makeStore();
    const res = store.update({ sessionsPerProvider: 8, idleExitMinutes: 0 });
    expect(res.errors).toBeUndefined();
    expect(res.settings?.sessionsPerProvider).toBe(8);
    expect(res.settings?.idleExitMinutes).toBe(0);
    expect(res.settings?.main).toEqual(DEFAULT_SETTINGS.main);
  });

  it("rejects invalid updates", () => {
    const store = makeStore();
    expect(store.update({ sessionsPerProvider: 0 }).errors).toMatchObject([
      expect.stringContaining("sessionsPerProvider"),
    ]);
    expect(store.update({ sessionsPerProvider: 33 }).errors).toHaveLength(1);
    expect(store.update({ rebuildSupersededRatio: 2 }).errors).toHaveLength(1);
    expect(store.update({ main: { provider: "", model: "" } }).errors).toHaveLength(1);
    expect(store.update({ nope: 1 } as never).errors).toMatchObject([
      expect.stringContaining("unknown setting"),
    ]);
    // Nothing persisted on failure.
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("StaticModelCatalog", () => {
  it("lists static defaults per provider", () => {
    const catalog = new StaticModelCatalog();
    expect(catalog.listModels("claude").length).toBeGreaterThan(0);
    expect(catalog.listModels("codex").map((m) => m.id)).toContain("gpt-5.4");
    expect(catalog.listModels("unknown")).toEqual([]);
  });
});

describe("settings + jobs routes", () => {
  it("GET/PUT /api/settings and GET /api/models", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare("INSERT OR IGNORE INTO repos (id, owner, name, local_path) VALUES ('r', 'o', 'n', '/t')").run();
    db.prepare("INSERT OR IGNORE INTO reviews (id, repo_id, branch, created_at) VALUES ('r1', 'r', 'b', 0)").run();
    const { app } = await createApp("tok", {settings: new SettingsStore(db),
      models: new StaticModelCatalog(),
      jobs: new JobQueue(), autoPipeline: false});
    const auth = { authorization: "Bearer tok" };
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
      expect(get.statusCode).toBe(200);
      expect(get.json().sessionsPerProvider).toBe(4);
      expect(get.json().cacheLifetimeMs).toBe(DEFAULT_SETTINGS.cacheLifetimeMs);

      const put = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { sessionsPerProvider: 2 },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().sessionsPerProvider).toBe(2);

      const bad = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { sessionsPerProvider: 99 },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().errors).toHaveLength(1);

      const models = await app.inject({ method: "GET", url: "/api/models?provider=codex", headers: auth });
      expect(models.statusCode).toBe(200);
      expect(models.json().provider).toBe("codex");
      expect(models.json().models.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(["gpt-5.4"]));

      const missing = await app.inject({ method: "GET", url: "/api/models", headers: auth });
      expect(missing.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("GET /api/jobs?review=, one job, prompt snapshot, cancel, reprioritise", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare("INSERT OR IGNORE INTO repos (id, owner, name, local_path) VALUES ('r', 'o', 'n', '/t')").run();
    db.prepare("INSERT OR IGNORE INTO reviews (id, repo_id, branch, created_at) VALUES ('r1', 'r', 'b', 0)").run();
    const { JobStore } = await import("../src/jobs/store.js");
    const store = new JobStore(db);
    const queue = new JobQueue({ getConcurrencyCap: () => 0, persist: store });
    const { app } = await createApp("tok", {jobs: queue, autoPipeline: false});
    const auth = { authorization: "Bearer tok" };
    try {
      const job = queue.enqueue({
        reviewId: "r1",
        kind: "explain",
        provider: "claude",
        model: "m",
        priority: 10,
        promptSnapshot: "THE PROMPT",
        run: async () => {},
      });

      const list = await app.inject({ method: "GET", url: "/api/jobs?review=r1", headers: auth });
      expect(list.statusCode).toBe(200);
      expect(list.json().jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);

      const one = await app.inject({ method: "GET", url: `/api/jobs/${job.id}`, headers: auth });
      expect(one.statusCode).toBe(200);
      expect(one.json().job.promptSnapshot).toBe("THE PROMPT");

      const prompt = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/prompt`, headers: auth });
      expect(prompt.statusCode).toBe(200);
      expect(prompt.json()).toEqual({ jobId: job.id, promptSnapshot: "THE PROMPT" });

      const missing = await app.inject({ method: "GET", url: "/api/jobs/nope", headers: auth });
      expect(missing.statusCode).toBe(404);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/jobs/${job.id}`,
        headers: auth,
        payload: { priority: 100 },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().job.priority).toBe(100);

      const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/cancel`, headers: auth });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().job.state).toBe("cancelled");

      const noReview = await app.inject({ method: "GET", url: "/api/jobs", headers: auth });
      expect(noReview.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
