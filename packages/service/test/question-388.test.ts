/**
 * ? mode (issue #388): `question-rewrite` fans out one ordinary #387
 * `slower` press per guide card, with the picked terms as reader context
 * and the whole guide in every card's turn.
 *
 * With the fake runner over HTTP: the prompt carries the terms and the
 * whole-guide context, every guide card is targeted with one job each,
 * each rewrite is one press (undo restores that card), and persona
 * variants are untouched (Guide version only). Plus the byte-identity
 * guard: an ordinary press (no terms) renders the pre-#388 prompt bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { questionRewriteTargetIds } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { loadTemplatesDirSync, renderTemplate } from "../src/prompts/index.js";
import { createApp } from "../src/server.js";
import { fixtureSnapshot } from "./fixtures.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
void fixturesDir;
const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const QUESTION_SLOWER = `A slower paragraph, with the reader terms explained where they first matter.

\`\`\`json
{"slower": {}}
\`\`\`
`;

/** Fake with static scripts (base ready + minimal reader + per-kind replies). */
function fakeWith(scripts: { match: string; events: AgentEvent[] }[]): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ...scripts,
  ]);
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function createDemoReview(app: {
  inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }>;
}): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  return (created.json() as ReviewSnapshot).review.id;
}

async function postAction(
  app: { inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }> },
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

async function waitForJob(
  ctx: { jobs: { get: (id: string) => { state: string } | undefined } },
  jobId: string,
  timeoutMs = 30000,
): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");

function cardText(snapshot: ReviewSnapshot, cardId: string): string {
  const card = snapshot.pages.flatMap((p) => p.cards).find((c) => c.id === cardId)!;
  return card.blocks
    .filter((b) => b.type === "paragraph")
    .map((b) => (b as { text: string }).text)
    .join("\n\n");
}

describe("question-rewrite (? mode, #388)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("an ordinary slower press renders the pre-#388 prompt bytes", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const tpl = lib.get("slower");
    if (!tpl) throw new Error("missing template slower");
    // Same card value as the (disabled) golden test.
    const snap = fixtureSnapshot();
    const card = `### ${snap.cards[0].title} [[card:${snap.cards[0].id}]]\n\n${snap.cards[0].markdown}\n`;
    const rendered = renderTemplate(tpl, { card, terms: "", guide: "" });
    // The golden was recorded by #387 for the terms-less template: empty
    // blocks must add nothing.
    expect(rendered).toBe(fs.readFileSync(path.join(TEST_DIR, "goldens", "slower.md"), "utf8"));
  });

  it("empty terms are rejected", { timeout: 60000 }, async () => {
    const { app } = await createApp("tok", {
      agents: fakeWith([{ match: "# Help me understand", events: textEvents(QUESTION_SLOWER) }]),
    });
    try {
      const id = await createDemoReview(app);
      const res = await postAction(app, id, { kind: "question-rewrite", terms: [] });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("rewrites every guide card with the terms; undo restores one card only", { timeout: 120000 }, async () => {
    const agents = fakeWith([{ match: "# Help me understand", events: textEvents(QUESTION_SLOWER) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      const before = ctx.reviews.getSnapshot(id)!;
      const targets = questionRewriteTargetIds(before);
      expect(targets.length).toBeGreaterThan(1);
      const beforeTexts = new Map(targets.map((c) => [c, cardText(before, c)] as const));

      const res = await postAction(app, id, { kind: "question-rewrite", terms: ["obs-fold", "HTTPMessage"] });
      expect(res.status).toBe(200);
      expect(res.json.accepted).toBe(true);
      const cardJobs = res.json.cardJobs as { cardId: string; jobId?: string }[];
      // All guide cards targeted, one job each.
      expect(cardJobs.map((j) => j.cardId).sort()).toEqual([...targets].sort());
      for (const j of cardJobs) expect(j.jobId).toBeTruthy();
      for (const j of cardJobs) await waitForJob(ctx, j.jobId as string);

      // The prompt carries the terms and the whole-guide context.
      const prompt = agents.prompts[agents.prompts.length - 1].text;
      expect(prompt).toContain("Terms the reader doesn't understand");
      expect(prompt).toContain('"obs-fold"');
      expect(prompt).toContain('"HTTPMessage"');
      expect(prompt).toContain("Whole guide");
      // Whole-guide context: another card's marker is in this card's turn.
      const other = targets.find((c) => c !== cardJobs[cardJobs.length - 1].cardId)!;
      expect(prompt).toContain(`[[card:${other}]]`);

      // Every guide card changed, each exactly one press deep.
      const after = ctx.reviews.getSnapshot(id)!;
      for (const c of targets) {
        expect(cardText(after, c)).not.toBe(beforeTexts.get(c));
        const card = after.pages.flatMap((p) => p.cards).find((x) => x.id === c)!;
        expect(card.undoStack.length).toBe(1);
        // Guide version only: no persona variant was created or touched.
        expect(card.variants ?? {}).toEqual({});
      }

      // Undo restores one card and leaves the rest rewritten.
      const undone = targets[0];
      const undo = await postAction(app, id, { kind: "undo", cardId: undone });
      expect(undo.status).toBe(200);
      const settled = ctx.reviews.getSnapshot(id)!;
      expect(cardText(settled, undone)).toBe(beforeTexts.get(undone));
      for (const c of targets.slice(1)) {
        expect(cardText(settled, c)).not.toBe(beforeTexts.get(c));
      }
    } finally {
      await app.close();
    }
  });
});
