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
  PERSONA_COLORS,
  type AgentEvent,
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

  it("fresh settings seed Clarity enabled on the main model", async () => {
    const { app } = await makeApp();
    try {
      const get = await app.inject({ method: "GET", url: "/api/settings", headers: { authorization: "Bearer tok" } });
      expect(get.statusCode).toBe(200);
      const body = get.json() as Settings;
      const clarity = body.personas.find((p) => p.id === "clarity");
      expect(clarity).toBeDefined();
      expect(clarity).toMatchObject({
        name: "Clarity",
        provider: "claude",
        model: "claude-opus-5-5",
        enabled: true,
      });
      expect(clarity!.cardInstruction).toBe(
        "Rewrite this card's prose following your lens: the same facts, scope, hedges and citations, clearer to an engineer. If the card is already effective, return it unchanged.",
      );
      expect(clarity!.color).toBe(PERSONA_COLORS[1]);
      // Second opinion still seeds first (colour order is stable).
      expect(body.personas.map((p) => p.id)).toEqual(["second-opinion", "clarity"]);
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
});

describe("Clarity card run (fake runner)", () => {
  async function openDemo(agents: FakeAgentRunner): Promise<{ app: Awaited<ReturnType<typeof createApp>>["app"]; ctx: Awaited<ReturnType<typeof createApp>>["ctx"]; id: string }> {
    const { app, ctx } = await createApp("tok", { agents });
    const created = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: { authorization: "Bearer tok" },
      payload: { repoId: "demo" },
    } as never);
    expect(created.statusCode).toBe(201);
    const id = (created.json() as ReviewSnapshot).review.id;
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
      // The run reached the runner on the main model with the lens.
      const starts = agents.starts.filter(
        (s) => s.provider === "claude" && s.model === "claude-opus-5-5",
      );
      expect(starts.length).toBeGreaterThan(0);
      expect(starts.some((s) => s.systemPrompt.includes("You are Clarity"))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
