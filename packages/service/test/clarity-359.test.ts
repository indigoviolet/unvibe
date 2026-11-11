/**
 * Built-in Clarity persona (issue #359):fake runner only, no live spend.
 *
 * - Fresh settings seed Clarity enabled on the main model with the
 *   card-rewrite instruction.
 * - The inline seed lens matches `prompts/personas/clarity/lens.md`
 *   (whitespace-insensitive: the file is the human-readable source, the
 *   inline copy is the runtime seed — this test keeps them from
 *   drifting).
 * - The composed prompt carries the lens, the Unvibe preservation rules
 *   (`[[…]]` tokens, `:::` containers, fences) and the card instruction.
 * - A Clarity run on a card stores a variant with its citations intact,
 *   on the main model.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLARITY_PERSONA,
  GUIDE_PERSONA_ID,
  PERSONA_COLORS,
  type AgentEvent,
  type Persona,
  type ReviewSnapshot,
  type Settings,
} from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { renderSystemPrompt } from "../src/prompts/access.js";
import { buildPersonaCardPromptFor, DEFAULT_CARD_INSTRUCTION } from "../src/prompts/personas.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");

const CARD = "### The central change [[card:c-central]]\n\nThe handler may fetch the value from the database.";

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

// Clarity's rewrite of the central card: clearer prose that keeps the
// guide's citation (a card token the validator accepts, so no repair
// turn runs and the variant stores with the citation intact).
const CLARITY_REWRITE = `The central change, rewritten for clarity. See the problem statement [[card:problem]].

\`\`\`json
{}
\`\`\`
`;

function clarityAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    { match: "# Persona card", events: textEvents(CLARITY_REWRITE) },
  ]);
}

describe("Clarity seed and prompt composition", () => {
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

  it("fresh settings seed Clarity following the main model", async () => {
    const { app } = await makeApp();
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } });
      expect(get.statusCode).toBe(200);
      const body = get.json() as Settings;
      const clarity = body.personas.find((p) => p.id === "clarity");
      expect(clarity).toBeDefined();
      expect(clarity).toMatchObject({
        name: "Clarity",
        followMain: true,
        // Stored last-explicit pick (display seed, not what runs).
        provider: "claude",
        model: "claude-opus-5-5",
        enabled: true,
      });
      expect(clarity!.cardInstruction).toBe(
        "Rewrite this card's prose following your lens: the same facts, scope, hedges and citations, clearer to an engineer. If the card is already effective, return it unchanged.",
      );
      expect(clarity!.color).toBe(PERSONA_COLORS[1]);
      // Guide seeds first, then Second opinion (colour order is stable, #379).
      expect(body.personas.map((p) => p.id)).toEqual(["guide", "second-opinion", "clarity"]);
    } finally {
      await app.close();
    }
  });

  it("the inline seed lens matches prompts/personas/clarity/lens.md", () => {
    const raw = fs.readFileSync(path.join(REPO_PROMPTS, "personas", "clarity", "lens.md"), "utf8");
    // Drop the file's `# …` title heading; the seed starts at the lens body.
    const fileBody = raw.split("\n").slice(2).join("\n");
    const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();
    expect(normalize(CLARITY_PERSONA.lens)).toBe(normalize(fileBody));
  });

  it("the composed Clarity prompt carries the lens, preservation rules and card instruction", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const prompt = buildPersonaCardPromptFor(lib, "lockdown", CLARITY_PERSONA, CARD);
    // Layer 1: the shared base instructions, byte-identical to every session.
    expect(prompt.system.startsWith(renderSystemPrompt(lib, "lockdown"))).toBe(true);
    // Layer 2: the lens travels in the system prompt.
    expect(prompt.system).toContain("# Persona lens");
    expect(prompt.system).toContain("You are Clarity");
    // The Unvibe adaptations, edited into the lens text.
    expect(prompt.system).toContain("[[diff:…]]");
    expect(prompt.system).toContain("[[concept:…|…]]");
    expect(prompt.system).toContain("`:::` container");
    expect(prompt.system).toContain("d2 fences unchanged");
    expect(prompt.system).toContain("preserve the ambiguity");
    expect(prompt.system).not.toContain("ask one narrow question");
    // Layer 3: the card task with Clarity's override (not the default).
    expect(prompt.turn).toContain(CLARITY_PERSONA.cardInstruction);
    expect(prompt.turn).toContain(CARD);
    expect(prompt.turn).not.toContain(DEFAULT_CARD_INSTRUCTION);
    expect(prompt.cardInstruction).toBe(CLARITY_PERSONA.cardInstruction);
  });
  it("a main-following stored pick that no adapter offers still saves", async () => {
    const { app } = await makeApp();
    try {
      const seed = (await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } }).then((r) => r.json())) as Settings;
      const res = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: {
          personas: [
            ...seed.personas,
            {
              id: "mime",
              name: "Mime",
              followMain: true,
              provider: "claude",
              model: "opus-9",
              lens: "You are a mime.",
              cardInstruction: "",
              enabled: true,
              color: PERSONA_COLORS[2],
            },
          ],
        },
      });
      // Exempt from the offered check: the stored pick is not what runs.
      expect(res.statusCode).toBe(200);
      // The same pick pinned is rejected.
      const pinned = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: "Bearer tok" },
        payload: {
          personas: [
            ...seed.personas,
            {
              id: "mime",
              name: "Mime",
              followMain: false,
              provider: "claude",
              model: "opus-9",
              lens: "You are a mime.",
              cardInstruction: "",
              enabled: true,
              color: PERSONA_COLORS[2],
            },
          ],
        },
      });
      expect(pinned.statusCode).toBe(400);
      expect(JSON.stringify(pinned.json())).toContain("not offered");
    } finally {
      await app.close();
    }
  });
});

describe("lens in every persona turn (option B)", () => {
  const ASK_REPLY = `The persona's answer about the fold.\n\n\`\`\`json\n{}\n\`\`\`\n`;
  const DEPTH_SIMPLE = `A simpler variant line.\n\n\`\`\`json\n{"depth": {"level": "simple"}}\n\`\`\`\n`;
  const EXAMPLES_REPLY = `::: example\n\`\`\`\nexample one\n\`\`\`\n:::\n\n\`\`\`json\n{}\n\`\`\`\n`;
  const REPAIRED = `The persona's rewritten version.\n\n\`\`\`json\n{}\n\`\`\`\n`;

  function lensAgents(): FakeAgentRunner {
    return new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      // Safety net below the repair threshold tests: any repair turn
      // still resolves (citations in the scripted replies verify, so it
      // never runs).
      { match: "could not be verified", events: textEvents(REPAIRED) },
      { match: "# Persona card", events: textEvents(CLARITY_REWRITE) },
      { match: "# Ask", events: textEvents(ASK_REPLY) },
      { match: "# Depth rewrite", events: textEvents(DEPTH_SIMPLE) },
      { match: "# Examples", events: textEvents(EXAMPLES_REPLY) },
    ]);
  }

  async function runCard(agents: FakeAgentRunner): Promise<{ app: Awaited<ReturnType<typeof createApp>>["app"]; ctx: Awaited<ReturnType<typeof createApp>>["ctx"]; id: string }> {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx, id } = await openDemo(agents);
    const res = await app.inject({
      method: "POST",
      url: `/api/reviews/${id}/actions`,
      headers: { authorization: "Bearer tok" },
      payload: { kind: "persona", cardId: "problem", personaId: "clarity" },
    } as never);
    expect(res.statusCode).toBe(200);
    const jobId = (res.json() as { jobId?: string }).jobId;
    if (jobId) expect(await waitForJob(ctx, jobId)).toBe("done");
    await waitFor(() => {
      const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
      const variant = card?.variants?.["clarity"];
      return !!variant && variant.blocks.length > 0 && !variant.working;
    });
    return { app, ctx, id };
  }

  async function runJob(
    app: Awaited<ReturnType<typeof createApp>>["app"],
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    id: string,
    body: unknown,
  ): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: `/api/reviews/${id}/actions`,
      headers: { authorization: "Bearer tok" },
      payload: body,
    } as never);
    expect(res.statusCode).toBe(200);
    const jobId = (res.json() as { jobId?: string }).jobId;
    if (jobId) expect(await waitForJob(ctx, jobId)).toBe("done");
  }

  /** Every recorded turn prompt carrying `marker` starts with the lens. */
  function expectLensInTurns(agents: FakeAgentRunner, marker: string, lensHead: string): void {
    const turns = agents.prompts.filter((p) => p.text.includes(marker));
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) {
      expect(t.text.startsWith(`# Persona lens\n\n${lensHead}`)).toBe(true);
    }
  }

  it("same-model persona (Clarity): card, explain, ask, depth and examples turns carry the lens; one base", { timeout: 180000 }, async () => {
    const agents = lensAgents();
    const { app, ctx, id } = await runCard(agents);
    try {
      await runJob(app, ctx, id, {
        kind: "explain",
        quote: "The problem paragraph.",
        anchor: { where: "block", blockId: "problem#b1" },
        personaId: "clarity",
      });
      await runJob(app, ctx, id, {
        kind: "ask",
        quote: "The problem paragraph.",
        anchor: { where: "block", blockId: "problem#b1" },
        message: "Why this fold?",
        personaId: "clarity",
      });
      await runJob(app, ctx, id, { kind: "depth", cardId: "problem", direction: "simpler", personaId: "clarity" });
      await runJob(app, ctx, id, { kind: "examples", cardId: "problem", personaId: "clarity" });
      const lensHead = "You are Clarity";
      for (const marker of ["# Persona card", "# Ask", "# Depth rewrite", "# Examples"]) {
        expectLensInTurns(agents, marker, lensHead);
      }
      // No extra base: Clarity shares main's base (same provider/model).
      expect(ctx.sessions.baseKeys()).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("different-model persona (Second opinion): card and ask turns carry the lens; own base as before", { timeout: 180000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = lensAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      await runJob(app, ctx, id, { kind: "persona", cardId: "problem", personaId: "second-opinion" });
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        const variant = card?.variants?.["second-opinion"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      await runJob(app, ctx, id, {
        kind: "ask",
        quote: "The problem paragraph.",
        anchor: { where: "block", blockId: "problem#b1" },
        message: "Why this fold?",
        personaId: "second-opinion",
      });
      // Second opinion's replies reuse the seeded check behaviour.
      const variant = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!.variants!["second-opinion"];
      expect(variant.error ?? null).toBeNull();
      const lensHead = "You are a second reader";
      for (const marker of ["# Persona card", "# Ask"]) {
        expectLensInTurns(agents, marker, lensHead);
      }
      // A different model keeps its own base (pre-existing #349
      // behaviour): main's plus the persona's.
      expect(ctx.sessions.baseKeys()).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
async function openDemo(agents: FakeAgentRunner, main?: { provider: string; model: string }): Promise<{ app: Awaited<ReturnType<typeof createApp>>["app"]; ctx: Awaited<ReturnType<typeof createApp>>["ctx"]; id: string }> {
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: { authorization: "Bearer tok" },
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  if (main) {
    const seed = (ctx.settings.get().personas ?? []) as Persona[];
    const patched = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: "Bearer tok" },
      payload: {
        personas: seed.map((p) => (p.id === GUIDE_PERSONA_ID ? { ...p, ...main } : p)),
      },
    } as never);
    expect(patched.statusCode).toBe(200);
  }
  await waitFor(
    () =>
      !!ctx.reviews
        .getSnapshot(id)
        ?.pages.find((p) => p.id === "root")
        ?.cards.find((c) => c.id === "problem")?.blocks.length,
  );
  return { app, ctx, id };
}

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function waitForJob(c: Awaited<ReturnType<typeof createApp>>["ctx"], jid: string, timeoutMs = 60000): Promise<string> {
  let state = "";
  await waitFor(
    () => {
      const j = c.jobs.get(jid);
      if (!j) return false;
      state = j.state;
      return state === "done" || state === "error" || state === "cancelled";
    },
    timeoutMs,
  );
  return state;
}

describe("Clarity card run (fake runner)", () => {
  it("runs on the main model and stores the variant with citations intact", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = clarityAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/actions`,
        headers: { authorization: "Bearer tok" },
        payload: { kind: "persona", cardId: "central", personaId: "clarity" },
      } as never);
      expect(res.statusCode).toBe(200);
      const jobId = (res.json() as { jobId?: string }).jobId;
      if (jobId) {
        const state = await waitForJob(ctx, jobId);
        expect(state).toBe("done");
      }
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "central");
        const variant = card?.variants?.["clarity"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      const variant = card.variants!["clarity"];
      expect(variant.revision).toBe(1);
      expect(variant.error ?? null).toBeNull();
      // The rewrite kept the guide's citation token intact.
      expect(JSON.stringify(variant.blocks)).toContain("card:problem");
      expect(JSON.stringify(variant.blocks)).toContain("rewritten for clarity");
      // The run reached the runner on the main model with the lens at
      // the start of the turn (option B: the shared base stays L0).
      const starts = agents.starts.filter(
        (s) => s.provider === "claude" && s.model === "claude-opus-5-5",
      );
      expect(starts.length).toBeGreaterThan(0);
      const turns = agents.prompts.filter((p) => p.text.includes("# Persona card"));
      expect(turns.length).toBeGreaterThan(0);
      expect(turns.every((t) => t.text.startsWith("# Persona lens\n\nYou are Clarity"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("follows the main model when it changes (not the stored pick)", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = clarityAgents();
    // No models catalog in this app: the PUT skips the offered check
    // and the stored pick stands as the effective main.
    const { app, ctx, id } = await openDemo(agents, { provider: "claude", model: "claude-sonnet-5-5" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/actions`,
        headers: { authorization: "Bearer tok" },
        payload: { kind: "persona", cardId: "central", personaId: "clarity" },
      } as never);
      expect(res.statusCode).toBe(200);
      const jobId = (res.json() as { jobId?: string }).jobId;
      if (jobId) {
        const state = await waitForJob(ctx, jobId);
        expect(state).toBe("done");
      }
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "central");
        const variant = card?.variants?.["clarity"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.variants!["clarity"].error ?? null).toBeNull();
      // The run followed main to sonnet — not the stored opus fallback —
      // with the lens at the start of the turn.
      const followed = agents.starts.filter(
        (s) => s.provider === "claude" && s.model === "claude-sonnet-5-5",
      );
      expect(followed.length).toBeGreaterThan(0);
      const turns = agents.prompts.filter((p) => p.text.includes("# Persona card"));
      expect(turns.length).toBeGreaterThan(0);
      expect(turns.every((t) => t.text.startsWith("# Persona lens\n\nYou are Clarity"))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
