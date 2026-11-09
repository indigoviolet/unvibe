/**
 * Personas run on cards, issue #349 step 2 — with the scripted fake
 * runner over HTTP (`POST /api/reviews/:id/actions`) on the demo review:
 * - a persona run stores a variant keyed by persona (same blocks shape,
 *   own revision, its own session);
 * - the run reaches the runner on the persona's provider/model with the
 *   lens in the system prompt (never the main role);
 * - an unverified citation gets the single repair turn, then stores;
 * - Ask on the variant is answered by the same persona (thread carries
 *   the persona; the turn reuses its model);
 * - depth simpler/deeper on the variant rewrites the variant's blocks.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

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

// First persona attempt: two unverifiable citations (the repair
// threshold, so the single repair turn runs); the persona's own card
// text otherwise.
const PERSONA_INVALID = `The persona's version of the card. [[diff:no-such-file:1-2]] [[diff:no-such-file:3-4]]

\`\`\`json
{}
\`\`\`
`;

// A single unverifiable citation: below the repair threshold, so the
// variant stores with the normal unverified mark (red text, not a banner).
const PERSONA_ONE_BAD = `The persona's version of the central change. [[diff:no-such-file:1-2]]

\`\`\`json
{}
\`\`\`
`;

// Repair-turn reply (matches the repair prompt's marker): clean text,
// no citations — stores as-is.
const PERSONA_REPAIRED = `The persona's version of the central change.

\`\`\`json
{}
\`\`\`
`;

const ASK_ON_VARIANT = `The persona's answer about the fold.

\`\`\`json
{}
\`\`\`
`;

const PERSONA = {
  id: "historian",
  name: "Historian",
  followMain: false,
  color: "#C2410C",
  lens: "You are the keeper of this codebase's history. Mention the year 1999 in every run.",
  cardInstruction: "",
  provider: "codex",
  model: "codex-persona-model",
  enabled: true,
};

type App = Awaited<ReturnType<typeof createApp>>;

async function openDemo(agents: FakeAgentRunner): Promise<{ app: App["app"]; ctx: App["ctx"]; id: string }> {
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
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
  // Personas live in settings (step 1); the run under test uses them.
  const patched = await app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: authed,
    payload: { personas: [PERSONA] },
  } as never);
  expect(patched.statusCode).toBe(200);
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

async function postAction(
  app: App["app"],
  id: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/reviews/${id}/actions`,
    headers: authed,
    payload: body,
  } as never);
  return { status: res.statusCode, json: (res.json() ?? {}) as Record<string, unknown> };
}

async function waitForJob(ctx: App["ctx"], jobId: string, timeoutMs = 60000): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

function personaAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    // The repair turn carries the validator's marker — it must win over
    // the persona-card script (first match wins). The lens travels in the
    // system prompt (asserted via `starts`), never in the turn text.
    { match: "could not be verified", events: textEvents(PERSONA_REPAIRED) },
    // The central card's guide text only appears in its own persona turn.
    { match: "The central paragraph", events: textEvents(PERSONA_ONE_BAD) },
    { match: "# Persona card", events: textEvents(PERSONA_INVALID) },
    { match: "# Ask", events: textEvents(ASK_ON_VARIANT) },
    { match: "# Depth rewrite", events: textEvents("A simpler variant line.\n\n```json\n{\"depth\": {\"level\": \"simple\"}}\n```\n") },
  ]);
}

describe("persona card runs (#349 step 2)", () => {
  it("stores the variant and runs on the persona provider/model with the lens", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = personaAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "persona", cardId: "problem", personaId: "historian" });
      expect(res.status).toBe(200);
      if (res.json.jobId) {
        const state = await waitForJob(ctx, res.json.jobId as string);
        expect(state).toBe("done");
      }
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        const variant = card?.variants?.["historian"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      const variant = card.variants!["historian"];
      expect(variant.revision).toBe(1);
      expect(variant.error ?? null).toBeNull();
      expect(variant.sessionId).toMatch(/^fake-/);
      // The guide card itself is untouched.
      expect(card.blocks.length).toBeGreaterThan(0);
      // The persona's provider/model reached the runner — and the lens
      // travelled in a system prompt (not the main role's).
      const personaStarts = agents.starts.filter(
        (s) => s.provider === "codex" && s.model === "codex-persona-model",
      );
      expect(personaStarts.length).toBeGreaterThan(0);
      expect(personaStarts.some((s) => s.systemPrompt.includes("Mention the year 1999"))).toBe(true);
      const personaCalls = agents.startCalls.filter(
        (s) => s.provider === "codex" && s.model === "codex-persona-model",
      );
      expect(personaCalls.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("one repair turn fixes unverified citations, then stores", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = personaAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      // PERSONA_INVALID carries two bogus citations (the repair
      // threshold); the repair turn (PERSONA_REPAIRED) stores clean text.
      const res = await postAction(app, id, { kind: "persona", cardId: "problem", personaId: "historian" });
      expect(res.status).toBe(200);
      if (res.json.jobId) {
        const state = await waitForJob(ctx, res.json.jobId as string);
        expect(state).toBe("done");
      }
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        const variant = card?.variants?.["historian"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      const variant = card.variants!["historian"];
      expect(variant.error ?? null).toBeNull();
      const text = JSON.stringify(variant.blocks);
      expect(text).not.toContain("no-such-file");
      expect(text).toContain("persona's version");
      // The single repair turn actually ran.
      expect(agents.prompts.some((p) => p.text.includes("could not be verified"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("a lone unverified citation stores with the normal unverified mark", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = personaAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      // PERSONA_ONE_BAD carries one bogus citation: below the repair
      // threshold, so the variant stores with the red-text mark (no
      // banner, no retry).
      const res = await postAction(app, id, { kind: "persona", cardId: "central", personaId: "historian" });
      expect(res.status).toBe(200);
      if (res.json.jobId) {
        const state = await waitForJob(ctx, res.json.jobId as string);
        expect(state).toBe("done");
      }
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "central");
        const variant = card?.variants?.["historian"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      const variant = card.variants!["historian"];
      expect(variant.error ?? null).toBeNull();
      expect(JSON.stringify(variant.blocks)).toContain("no-such-file");
    } finally {
      await app.close();
    }
  });

  it("Ask on the variant is answered by the same persona", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = personaAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const run = await postAction(app, id, { kind: "persona", cardId: "problem", personaId: "historian" });
      expect(run.status).toBe(200);
      if (run.json.jobId) await waitForJob(ctx, run.json.jobId as string);
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        return !!card?.variants?.["historian"]?.blocks.length;
      });
      const res = await postAction(app, id, {
        kind: "ask",
        quote: "The problem paragraph.",
        anchor: { where: "block", blockId: "problem#b1" },
        message: "Why this fold?",
        personaId: "historian",
      });
      expect(res.status).toBe(200);
      const annotationId = res.json.annotationId as string;
      expect(annotationId).toMatch(/^ann_/);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        return !!a && (a.replies ?? []).length > 0 && (a.replies ?? [])[0].blocks.length > 0;
      });
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(thread.personaId).toBe("historian");
      expect(thread.personaCardId).toBe("problem");
      const answer = JSON.stringify((thread.replies ?? [])[0].blocks);
      expect(answer).toContain("persona's answer");
      // The answer ran on the persona's model (a later persona turn —
      // distinct from the guide's Ask path).
      const askCalls = agents.startCalls.filter(
        (s) => s.provider === "codex" && s.model === "codex-persona-model",
      );
      expect(askCalls.length).toBeGreaterThan(1);
    } finally {
      await app.close();
    }
  });

  it("depth on the variant rewrites the variant, not the guide", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = personaAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const run = await postAction(app, id, { kind: "persona", cardId: "problem", personaId: "historian" });
      expect(run.status).toBe(200);
      if (run.json.jobId) await waitForJob(ctx, run.json.jobId as string);
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        return !!card?.variants?.["historian"]?.blocks.length;
      });
      const before = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      const guideTextBefore = JSON.stringify(before.blocks);
      const res = await postAction(app, id, {
        kind: "depth",
        cardId: "problem",
        direction: "simpler",
        personaId: "historian",
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        return (card?.variants?.["historian"]?.revision ?? 0) >= 2;
      });
      const after = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      expect(JSON.stringify(after.blocks)).toBe(guideTextBefore);
      expect(after.variants!["historian"].level).toBe("simple");
      expect(JSON.stringify(after.variants!["historian"].blocks)).toContain("simpler variant");
    } finally {
      await app.close();
    }
  });
});
