/**
 * Main agent as a persona (issue #379): the fixed Guide owns the main
 * provider + model and a writing-style lens (empty by default).
 *
 * - Empty lens: main writing turns are byte-identical to today, and the
 *   base/system prompt never depends on the lens.
 * - Set lens: prefixed to every main writing turn (guide, cards, depth,
 *   Explain, Ask) as a subordinate style section; the task's own rules
 *   stay authoritative. Persona turns never carry it.
 *
 * Fake runner only; no live spend.
 */
import { describe, expect, it } from "vitest";
import {
  GUIDE_PERSONA_ID,
  type Persona,
  type ReviewSnapshot,
} from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import type { AgentEvent } from "@unvibe/shared";
import { createApp } from "../src/server.js";
import {
  GUIDE_STYLE_TEMPLATES,
  withGuideStyleForTurn,
  withGuideWritingStyle,
} from "../src/prompts/personas.js";

const LENS = "Write with short sentences. No jargon without a gloss.";
const PROMPT = "# Depth rewrite\n\nRewrite the card below at the requested level.";

describe("withGuideWritingStyle", () => {
  it("leaves the prompt byte-identical when the lens is empty", () => {
    expect(withGuideWritingStyle(PROMPT, "")).toBe(PROMPT);
    expect(withGuideWritingStyle(PROMPT, "   ")).toBe(PROMPT);
  });

  it("prefixes a labelled style section that stays subordinate to the task", () => {
    const out = withGuideWritingStyle(PROMPT, LENS);
    expect(out.startsWith(`# Writing style\n\n${LENS}\n\n`)).toBe(true);
    expect(out).toContain("tone and wording only");
    expect(out).toContain("the task's rules below");
    expect(out.endsWith(PROMPT)).toBe(true);
  });
});

describe("withGuideStyleForTurn", () => {
  it("covers exactly the main writing tasks", () => {
    expect([...GUIDE_STYLE_TEMPLATES].sort()).toEqual(
      ["ask", "ask_turn", "depth", "go_deeper", "reader"].sort(),
    );
  });

  it("prefixes main tasks, passes persona and small tasks through", () => {
    for (const template of ["reader", "go_deeper", "depth", "ask", "ask_turn"]) {
      expect(withGuideStyleForTurn(template, PROMPT, LENS).startsWith("# Writing style")).toBe(
        true,
      );
      expect(withGuideStyleForTurn(template, PROMPT, "")).toBe(PROMPT);
    }
    for (const template of ["persona_card", "examples", "diagram", "concept_page", "hunk_pass"]) {
      expect(withGuideStyleForTurn(template, PROMPT, LENS)).toBe(PROMPT);
    }
  });
});

describe("Guide lens on main card turns (fake runner)", () => {
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

  function cardAgents(): FakeAgentRunner {
    return new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "# Go deeper", events: textEvents("fresh card body") },
    ]);
  }

  async function openDemo(agents: FakeAgentRunner): Promise<{
    app: Awaited<ReturnType<typeof createApp>>["app"];
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
    id: string;
  }> {
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

  async function setGuideLens(
    app: Awaited<ReturnType<typeof createApp>>["app"],
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    lens: string,
  ): Promise<void> {
    const seed = (ctx.settings.get().personas ?? []) as Persona[];
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: "Bearer tok" },
      payload: {
        personas: seed.map((p) => (p.id === GUIDE_PERSONA_ID ? { ...p, lens } : p)),
      },
    } as never);
    expect(res.statusCode).toBe(200);
  }

  async function runGenerate(
    agents: FakeAgentRunner,
    app: Awaited<ReturnType<typeof createApp>>["app"],
    ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
    id: string,
  ): Promise<string | undefined> {
    // A fresh placeholder card: generation always calls the agent (no
    // stored reuse like depth levels).
    await ctx.reviews.mutate(id, (draft) => {
      const root = (draft.pages ?? []).find((p) => p.id === "root");
      root?.cards.push({
        id: "pending-1",
        title: "Pending card",
        level: "standard",
        blocks: [],
        pending: { label: "Pending card", why: "covers the gap" },
      } as never);
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/reviews/${id}/actions`,
      headers: { authorization: "Bearer tok" },
      payload: { kind: "generate", cardId: "pending-1" },
    } as never);
    expect(res.statusCode).toBe(200);
    const jobId = (res.json() as { jobId?: string }).jobId;
    // Only the sent turn matters here (the fake reply never parses into
    // a card, so the job itself may error — the prompt already ran).
    await waitFor(() => agents.prompts.some((p) => p.text.includes("# Go deeper")), 120000);
    return jobId;
  }

  it(
    "set lens is prefixed to the depth turn with the task rules intact; the base never sees it",
    { timeout: 180000 },
    async () => {
      process.env.UNVIBE_REPO_ROOTS = "";
      const agents = cardAgents();
      const { app, ctx, id } = await openDemo(agents);
      try {
        await setGuideLens(app, ctx, LENS);
        await runGenerate(agents, app, ctx, id);
        const turns = agents.prompts.filter((p) => p.text.includes("# Go deeper"));
        expect(turns.length).toBeGreaterThan(0);
        for (const turn of turns) {
          expect(turn.text.startsWith(`# Writing style\n\n${LENS}\n\n`)).toBe(true);
          // The task's own rules stay in the turn, below the style section.
          expect(turn.text).toContain("# Go deeper");
          expect(turn.text).toContain("## Rules");
        }
        // The run used the Guide's model…
        const guideModel = (ctx.settings.get().personas ?? []).find(
          (p) => p.id === GUIDE_PERSONA_ID,
        )!.model;
        expect(
          agents.startCalls.some(
            (s) => s.provider === "claude" && s.model === guideModel && s.effort === "",
          ),
        ).toBe(true);
        // …while no session's base/system prompt carries the lens.
        for (const start of agents.starts) {
          expect(start.systemPrompt).not.toContain(LENS);
        }
      } finally {
        await app.close();
      }
    },
  );

  it(
    "empty lens leaves main turns byte-identical (no style section anywhere)",
    { timeout: 180000 },
    async () => {
      process.env.UNVIBE_REPO_ROOTS = "";
      const agents = cardAgents();
      const { app, ctx, id } = await openDemo(agents);
      try {
        await runGenerate(agents, app, ctx, id);
        const turns = agents.prompts.filter((p) => p.text.includes("# Go deeper"));
        expect(turns.length).toBeGreaterThan(0);
        for (const turn of turns) {
          expect(turn.text).not.toContain("# Writing style");
        }
        for (const start of agents.starts) {
          expect(start.systemPrompt).not.toContain("# Writing style");
        }
      } finally {
        await app.close();
      }
    },
  );

  it(
    "guide effort reaches the main run; followMain personas keep the adapter default",
    { timeout: 180000 },
    async () => {
      process.env.UNVIBE_REPO_ROOTS = "";
      const LENS2 = "Terse prose.";
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        { match: "# Go deeper", events: textEvents("fresh card body") },
        {
          match: "# Persona card",
          events: textEvents(
            `The problem, rewritten for clarity. See the problem statement [[card:problem]].\n\n\`\`\`json\n{}\n\`\`\`\n`,
          ),
        },
        {
          match: "# Depth rewrite",
          events: textEvents(`A simpler variant line.\n\n\`\`\`json\n{"depth": {"level": "simple"}}\n\`\`\`\n`),
        },
      ]);
      const { app, ctx, id } = await openDemo(agents);
      try {
        // Guide on a non-default effort with a lens set.
        const seed = (ctx.settings.get().personas ?? []) as Persona[];
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings",
          headers: { authorization: "Bearer tok" },
          payload: {
            personas: seed.map((p) => (p.id === GUIDE_PERSONA_ID ? { ...p, lens: LENS2, effort: "high" } : p)),
          },
        } as never);
        expect(res.statusCode).toBe(200);
        // Main run: the job stamp and the base session carry the effort.
        const jobId = await runGenerate(agents, app, ctx, id);
        expect(jobId).toBeDefined();
        expect(ctx.jobs.get(jobId!)?.effort).toBe("high");
        expect(agents.startCalls.some((c) => c.effort === "high")).toBe(true);
        // followMain persona run: no Guide lens in its turns, effort stays Default.
        const run = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: { authorization: "Bearer tok" },
          payload: { kind: "persona", cardId: "problem", personaId: "clarity" },
        } as never);
        expect(run.statusCode).toBe(200);
        const personaJobId = (run.json() as { jobId?: string }).jobId;
        await waitFor(() => {
          const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
          const variant = card?.variants?.["clarity"];
          return !!variant && variant.blocks.length > 0 && !variant.working;
        }, 120000);
        const depth = await app.inject({
          method: "POST",
          url: `/api/reviews/${id}/actions`,
          headers: { authorization: "Bearer tok" },
          payload: { kind: "depth", cardId: "problem", direction: "simpler", personaId: "clarity" },
        } as never);
        expect(depth.statusCode).toBe(200);
        const depthJobId = (depth.json() as { jobId?: string }).jobId;
        await waitFor(() => {
          const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
          return (card?.variants?.["clarity"]?.level ?? "") === "simple";
        }, 120000);
        for (const marker of ["# Persona card", "# Depth rewrite"]) {
          const turns = agents.prompts.filter((p) => p.text.includes(marker));
          expect(turns.length).toBeGreaterThan(0);
          for (const turn of turns) {
            expect(turn.text).not.toContain("# Writing style");
            expect(turn.text).not.toContain(LENS2);
          }
        }
        expect(personaJobId).toBeDefined();
        expect(ctx.jobs.get(personaJobId!)?.effort).toBe("");
        expect(depthJobId).toBeDefined();
        expect(ctx.jobs.get(depthJobId!)?.effort).toBe("");
      } finally {
        await app.close();
      }
    },
  );
});

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
