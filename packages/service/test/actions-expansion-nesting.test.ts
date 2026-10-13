/**
 * Explain, Ask and Note on text inside a conversation answer (#116, #136).
 *
 * With the replay runner over HTTP (`POST /api/reviews/:id/actions`):
 * the service accepts an answer block as the host for all three
 * actions, stores the annotation against `<answer>#<block>`, and
 * citation validation accepts `card:<answer>#<block>` targets.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";
import { lookupForSnapshot } from "../src/pipeline/lookup.js";
import { validateTarget } from "../src/validate/validate.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const authed = { authorization: "Bearer tok" };

function replay(): ReplayAgentRunner {
  return new ReplayAgentRunner({ fixturesDir, chunkChars: 256, delayMs: 0 });
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

type App = {
  inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }>;
  close: () => Promise<void>;
};

async function createDemoReview(app: App): Promise<string> {
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
  app: App,
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

describe("actions inside a conversation answer (#116, #136)", () => {
  it("explain, ask and note accept an answer block as host", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length;
      });

      // Parent explanation on a card block.
      const parent = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(parent.status).toBe(200);
      const parentId = parent.json.annotationId as string;
      expect(parentId).toMatch(/^ann_/);
      if (parent.json.jobId) {
        await waitFor(() =>
          ["done", "error", "cancelled"].includes(ctx.jobs.get(parent.json.jobId as string)?.state ?? ""),
        );
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
      const pexp = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === parentId)!;
      const parentTurnId = parent.json.turnId as string;
      const parentTurn = (pexp.turns ?? []).find((t) => t.id === parentTurnId)!;
      expect(parentTurn.blocks.length).toBeGreaterThan(0);
      const hostBlock = parentTurn.blocks[0] as { id: string; text?: { standard: string } };
      const quote = (hostBlock.text?.standard ?? "").slice(0, 20).trim();
      expect(quote).not.toBe("");
      const host = `${parentTurnId}#${hostBlock.id}`;

      // Nested explain on the expansion block fills like a card-level one.
      const nested = await postAction(app, id, {
        kind: "explain",
        quote,
        anchor: { where: "block", blockId: host },
      });
      expect(nested.status).toBe(200);
      const nestedId = nested.json.annotationId as string;
      expect(nestedId).toMatch(/^ann_/);
      if (nested.json.jobId) {
        await waitFor(() =>
          ["done", "error", "cancelled"].includes(ctx.jobs.get(nested.json.jobId as string)?.state ?? ""),
        );
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
      const done = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === nestedId)!;
      expect(done.type).toBe("conversation");
      expect(done.anchor.host).toMatchObject({ kind: "block", blockId: host });
      expect(done.turns?.[0]?.blocks.length ?? 0).toBeGreaterThan(0);

      // Ask on the same answer block creates a nested conversation card.
      const ask = await postAction(app, id, {
        kind: "ask",
        quote,
        anchor: { where: "block", blockId: host },
        message: "What does this mean?",
      });
      expect(ask.status).toBe(200);
      const askId = ask.json.annotationId as string;
      expect(askId).toMatch(/^ann_/);
      if (ask.json.jobId) {
        await waitFor(() =>
          ["done", "error", "cancelled"].includes(ctx.jobs.get(ask.json.jobId as string)?.state ?? ""),
        );
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
      const askCard = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === askId)!;
      expect(askCard.type).toBe("conversation");
      expect(askCard.anchor.host).toMatchObject({ kind: "block", blockId: host });
      expect((askCard.turns?.[0]?.blocks.length ?? 0)).toBeGreaterThan(0);

      // Note on the same answer block stores a quiet comment.
      const note = await postAction(app, id, {
        kind: "note",
        quote,
        anchor: { where: "block", blockId: host },
        text: "A reader note.",
      });
      expect(note.status).toBe(200);
      const noteThread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (note.json.annotationId as string))!;
      expect(noteThread.type).toBe("comment");
      expect(noteThread.anchor.host).toMatchObject({ kind: "block", blockId: host });

      // Citation validation accepts the answer block as a card target.
      const lookup = lookupForSnapshot(ctx.reviews.getSnapshot(id)!);
      expect(validateTarget(`card:${parentTurnId}#${hostBlock.id}`, lookup).status).toBe("valid");
    } finally {
      await app.close();
    }
  });
});
