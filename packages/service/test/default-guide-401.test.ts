/**
 * Default guide persona (issue #401).
 *
 * `defaultGuidePersonaId` (default `"guide"`) names the guide-capable
 * persona that writes new reviews and plain Re-do guide runs. The store
 * validates the shape (non-empty string); the settings route enforces
 * enabled + guide-capable (`reader.md`) with a 400; read sites resolve
 * the effective default (stored id when it still qualifies, else the
 * built-in Guide) and never write it back.
 *
 * No agents, no gh; a fixture prompts dir stands in for the repo prompts.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultPersonas, GUIDE_PERSONA_ID, type Persona } from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import { effectiveDefaultGuideId, isGuideCapable } from "../src/prompts/personas.js";
import { defaultGuideForNewReview } from "../src/routes/reviews.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");

const TUTOR: Persona = {
  id: "tutor",
  name: "Tutor",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: "A patient tutor lens.",
  cardInstruction: "",
  enabled: true,
  color: "#C2410C",
};

/**
 * Repo prompts plus a guide-capable `tutor` fork. Guide capability is
 * the fork holding `reader.md` (existence only), so a bare file stands
 * in for the `persona:fork` helper here.
 */
function makeGuidePrompts(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-401-"));
  cpSync(REPO_PROMPTS, dir, { recursive: true });
  mkdirSync(path.join(dir, "personas", "tutor"), { recursive: true });
  writeFileSync(path.join(dir, "personas", "tutor", "reader.md"), "# Tutor reader\n");
  return dir;
}

function personasWithTutor(): Persona[] {
  return [...defaultPersonas(), { ...TUTOR }];
}

describe("effectiveDefaultGuideId (read-time fallback, never written back)", () => {
  it("keeps a stored id that names an enabled guide-capable persona", () => {
    const dir = makeGuidePrompts();
    try {
      expect(isGuideCapable(dir, "tutor")).toBe(true);
      expect(effectiveDefaultGuideId(personasWithTutor(), dir, "tutor")).toBe("tutor");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to Guide when the persona is unknown, disabled, or de-forked", () => {
    const dir = makeGuidePrompts();
    try {
      expect(effectiveDefaultGuideId(personasWithTutor(), dir, "nobody")).toBe(GUIDE_PERSONA_ID);
      const disabled = personasWithTutor().map((p) => (p.id === "tutor" ? { ...p, enabled: false } : p));
      expect(effectiveDefaultGuideId(disabled, dir, "tutor")).toBe(GUIDE_PERSONA_ID);
      // Second opinion ships no fork: saved while capable is impossible,
      // but a stored id that loses reader.md still resolves to Guide.
      expect(effectiveDefaultGuideId(personasWithTutor(), dir, "second-opinion")).toBe(GUIDE_PERSONA_ID);
      // The built-in Guide needs no fork and always stands.
      expect(effectiveDefaultGuideId(personasWithTutor(), dir, GUIDE_PERSONA_ID)).toBe(GUIDE_PERSONA_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to Guide when the prompts dir cannot be located", () => {
    expect(effectiveDefaultGuideId(personasWithTutor(), null, "tutor")).toBe(GUIDE_PERSONA_ID);
    expect(effectiveDefaultGuideId(personasWithTutor(), undefined, "tutor")).toBe(GUIDE_PERSONA_ID);
    expect(effectiveDefaultGuideId(personasWithTutor(), null, GUIDE_PERSONA_ID)).toBe(GUIDE_PERSONA_ID);
  });
});

describe("settings validation (issue #401)", () => {
  function makeStore(): SettingsStore {
    const db = openDatabase(":memory:");
    migrate(db);
    return new SettingsStore(db);
  }

  it("seeds guide and persists a valid id (shape only; capability is the route's)", () => {
    const store = makeStore();
    expect(store.get().defaultGuidePersonaId).toBe(GUIDE_PERSONA_ID);
    expect(store.update({ defaultGuidePersonaId: "tutor" }).errors).toBeUndefined();
    expect(store.get().defaultGuidePersonaId).toBe("tutor");
  });

  it("rejects empty and non-string ids", () => {
    const store = makeStore();
    expect(store.update({ defaultGuidePersonaId: "" }).errors).toMatchObject([
      expect.stringContaining("defaultGuidePersonaId"),
    ]);
    expect(store.update({ defaultGuidePersonaId: 7 as never }).errors).toMatchObject([
      expect.stringContaining("defaultGuidePersonaId"),
    ]);
    expect(store.get().defaultGuidePersonaId).toBe(GUIDE_PERSONA_ID);
  });
});

describe("PUT /api/settings default-guide capability check (issue #401)", () => {
  const auth = { authorization: "Bearer tok" };

  async function makeApp() {
    const dir = makeGuidePrompts();
    const db = openDatabase(":memory:");
    migrate(db);
    const created = await createApp("tok", {
      settings: new SettingsStore(db),
      promptsDir: dir,
      autoPipeline: false,
    });
    return { ...created, dir };
  }

  async function putPersonas(app: { inject: (o: never) => Promise<{ statusCode: number }> }, personas: Persona[]) {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth,
      payload: { personas },
    } as never);
    expect(res.statusCode).toBe(200);
  }

  it("accepts an enabled guide-capable persona, even in the same update", async () => {
    const { app, dir } = await makeApp();
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { personas: personasWithTutor(), defaultGuidePersonaId: "tutor" },
      } as never);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { defaultGuidePersonaId: string }).defaultGuidePersonaId).toBe("tutor");
    } finally {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown, disabled, and non-guide-capable ids with a 400", async () => {
    const { app, dir } = await makeApp();
    try {
      await putPersonas(app, personasWithTutor());
      for (const [id, needle] of [
        ["nobody", "unknown persona"],
        ["second-opinion", "no reader.md"],
      ] as const) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings",
          headers: auth,
          payload: { defaultGuidePersonaId: id },
        } as never);
        expect(res.statusCode).toBe(400);
        expect(JSON.stringify(res.json())).toContain(needle);
      }
      const disabled = personasWithTutor().map((p) => (p.id === "tutor" ? { ...p, enabled: false } : p));
      await putPersonas(app, disabled);
      const res = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth,
        payload: { defaultGuidePersonaId: "tutor" },
      } as never);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain("disabled");
      // Nothing persisted on failure: the default still stands.
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth } as never);
      expect((get.json() as { defaultGuidePersonaId: string }).defaultGuidePersonaId).toBe(GUIDE_PERSONA_ID);
    } finally {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("defaultGuideForNewReview (create + plain redo stamp the default)", () => {
  it("returns the stored default when it qualifies, else Guide", () => {
    const dir = makeGuidePrompts();
    try {
      const qualified = {
        settings: { get: () => ({ personas: personasWithTutor(), defaultGuidePersonaId: "tutor" }) },
        promptsDir: dir,
      };
      expect(defaultGuideForNewReview(qualified as never)).toBe("tutor");
      const disabled = {
        settings: {
          get: () => ({
            personas: personasWithTutor().map((p) => (p.id === "tutor" ? { ...p, enabled: false } : p)),
            defaultGuidePersonaId: "tutor",
          }),
        },
        promptsDir: dir,
      };
      expect(defaultGuideForNewReview(disabled as never)).toBe(GUIDE_PERSONA_ID);
      const missing = { settings: undefined, promptsDir: dir };
      expect(defaultGuideForNewReview(missing as never)).toBe(GUIDE_PERSONA_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
