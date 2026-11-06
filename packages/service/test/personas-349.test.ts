/**
 * Personas v1 step 1 (issue #349):
 * - prompt composition (L0 base instructions + persona lens + the shared
 *   `persona_card` task) for the built-in Second opinion and a custom
 *   persona;
 * - Settings → Personas CRUD through `PUT /api/settings` (add, edit,
 *   inline-confirm delete is a UI flow over the same route).
 *
 * Fake runner only; no live spend.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PERSONA_COLORS,
  SECOND_OPINION_PERSONA,
  type Persona,
  type Settings,
} from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { renderSystemPrompt } from "../src/prompts/access.js";
import { buildPersonaCardPrompt, DEFAULT_CARD_INSTRUCTION } from "../src/prompts/personas.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");

const CARD = "### The central change [[card:c-central]]\n\nFolds that end in a bare LF are not unfolded.";

const CUSTOM: Persona = {
  id: "perf-sceptic",
  name: "Performance sceptic",
  provider: "claude",
  model: "claude-opus-5-5",
  lens: "You are a performance sceptic: you read every card asking what it costs at scale.",
  cardInstruction: "",
  enabled: true,
  color: PERSONA_COLORS[1],
};

describe("persona prompt composition (L0 + lens + task)", () => {
  it("composes the built-in Second opinion: base instructions, lens, card override", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const prompt = buildPersonaCardPrompt(lib, {
      access: "lockdown",
      lens: SECOND_OPINION_PERSONA.lens,
      card: CARD,
      cardInstruction: SECOND_OPINION_PERSONA.cardInstruction,
    });
    // Layer 1: the shared base instructions, byte-identical to every session.
    expect(prompt.system.startsWith(renderSystemPrompt(lib, "lockdown"))).toBe(true);
    // Layer 2: the lens travels in the system prompt.
    expect(prompt.system).toContain(SECOND_OPINION_PERSONA.lens);
    expect(prompt.system).toContain("# Persona lens");
    // Layer 3: the card task with the persona's override (not the default).
    expect(prompt.turn).toContain(SECOND_OPINION_PERSONA.cardInstruction);
    expect(prompt.turn).toContain(CARD);
    expect(prompt.turn).not.toContain(DEFAULT_CARD_INSTRUCTION);
    expect(prompt.cardInstruction).toBe(SECOND_OPINION_PERSONA.cardInstruction);
  });

  it("a custom persona with an empty card instruction gets the card default", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const prompt = buildPersonaCardPrompt(lib, {
      access: "lockdown",
      lens: CUSTOM.lens,
      card: CARD,
      cardInstruction: CUSTOM.cardInstruction,
    });
    expect(prompt.system.startsWith(renderSystemPrompt(lib, "lockdown"))).toBe(true);
    expect(prompt.system).toContain(CUSTOM.lens);
    expect(prompt.turn).toContain(DEFAULT_CARD_INSTRUCTION);
    expect(prompt.turn).toContain(CARD);
    expect(prompt.cardInstruction).toBe(DEFAULT_CARD_INSTRUCTION);
  });

  it("refuses a blank lens and a missing template", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    expect(() =>
      buildPersonaCardPrompt(lib, { access: "lockdown", lens: "  ", card: CARD }),
    ).toThrow(/lens must be a non-empty string/);
    const empty = new Map();
    expect(() =>
      buildPersonaCardPrompt(empty, { access: "lockdown", lens: CUSTOM.lens, card: CARD }),
    ).toThrow(/missing prompt template persona_card/);
  });
});

describe("Settings → Personas CRUD routes", () => {
  function stubCatalog(models: Record<string, string[]>): ModelCatalog {
    return {
      listModels: (p: string) => Promise.resolve((models[p] ?? []).map((id) => ({ id }))),
      offered: (p: string) =>
        Promise.resolve(
          p in models ? { models: (models[p] ?? []).map((id) => ({ id })), defaultId: null } : null,
        ),
    };
  }

  async function makeApp() {
    const db = openDatabase(":memory:");
    migrate(db);
    return createApp("tok", {
      settings: new SettingsStore(db),
      models: stubCatalog({
        claude: ["claude-opus-5-5", "claude-sonnet-5-5"],
        codex: ["gpt-6.1-sol"],
      }),
      jobs: new JobQueue(),
      autoPipeline: false,
    });
  }

  type SettingsBody = Settings;

  it("GET seeds the built-in Second opinion persona", async () => {
    const { app } = await makeApp();
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } });
      expect(get.statusCode).toBe(200);
      const body = get.json() as SettingsBody;
      // Issue #359 seeds a second built-in (Clarity) after Second opinion.
      expect(body.personas).toHaveLength(2);
      expect(body.personas.map((p) => p.id)).toEqual(["second-opinion", "clarity"]);
      expect(body.personas[0]).toMatchObject({
        id: "second-opinion",
        name: "Second opinion",
        provider: "codex",
        model: "gpt-6.1-sol",
        enabled: true,
      });
      expect(body.personas[0].lens.length).toBeGreaterThan(0);
      expect(body.personas[0].cardInstruction.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("PUT adds, edits and deletes personas", async () => {
    const { app } = await makeApp();
    try {
      const seed = (await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } }).then((r) => r.json())) as SettingsBody;

      // Add.
      const added = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: [...seed.personas, CUSTOM] },
      });
      expect(added.statusCode).toBe(200);
      expect((added.json() as SettingsBody).personas).toHaveLength(3);

      // Edit (rename + disable).
      const editedList = [...seed.personas, { ...CUSTOM, name: "Perf sceptic", enabled: false }];
      const edited = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: editedList },
      });
      expect(edited.statusCode).toBe(200);
      const editedBody = edited.json() as SettingsBody;
      expect(editedBody.personas.find((p) => p.id === CUSTOM.id)?.name).toBe("Perf sceptic");
      expect(editedBody.personas.find((p) => p.id === CUSTOM.id)?.enabled).toBe(false);

      // Delete (even the built-in: it is ordinary data after seeding).
      const deleted = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: editedList.filter((p) => p.id !== "second-opinion") },
      });
      expect(deleted.statusCode).toBe(200);
      expect((deleted.json() as SettingsBody).personas.map((p) => p.id)).toEqual(["clarity", CUSTOM.id]);

      // Round-trips through GET.
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } });
      expect((get.json() as SettingsBody).personas.map((p) => p.id)).toEqual(["clarity", CUSTOM.id]);
    } finally {
      await app.close();
    }
  });

  it("PUT rejects invalid persona lists", async () => {
    const { app } = await makeApp();
    try {
      const seed = (await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } }).then((r) => r.json())) as SettingsBody;

      // Not an array.
      const notArray = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: { id: "x" } },
      });
      expect(notArray.statusCode).toBe(400);

      // Blank name, blank lens, blank model.
      for (const broken of [
        { ...CUSTOM, name: "" },
        { ...CUSTOM, lens: "  " },
        { ...CUSTOM, model: "" },
      ]) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings",
          headers: { authorization: "Bearer tok" },
          payload: { personas: [...seed.personas, broken] },
        });
        expect(res.statusCode).toBe(400);
      }

      // Duplicate ids.
      const dup = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: [...seed.personas, CUSTOM, { ...CUSTOM, name: "Copy" }] },
      });
      expect(dup.statusCode).toBe(400);
      expect(JSON.stringify(dup.json())).toContain("duplicate persona id");

      // Colour outside the sequence.
      const badColor = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: [...seed.personas, { ...CUSTOM, color: "#ff0000" }] },
      });
      expect(badColor.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("PUT rejects a persona model no adapter offers", async () => {
    const { app } = await makeApp();
    try {
      const seed = (await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } }).then((r) => r.json())) as SettingsBody;
      const res = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: { personas: [...seed.personas, { ...CUSTOM, model: "opus-9" }] },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain("not offered");
    } finally {
      await app.close();
    }
  });
});
