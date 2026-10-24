/**
 * Stuck "Writing" turns (issue #272).
 *
 * - A fill that fails while its card is closed records the failure
 *   anyway: reopening shows the banner plus Retry (PRD §4.7: close only
 *   hides the card, and a failure shows the error with Retry).
 * - An explicitly cancelled fill (Debug cancel) settles quietly — no
 *   banner — but leaves no working flag, job link or partial answer
 *   behind, so the card never sticks.
 * - A graceful shutdown cancels every open fill; on the next boot the
 *   turns still marked working are settled as interrupted (banner plus
 *   Retry), instead of sticking forever.
 *
 * Through the real stack (live HTTP + job queue + store) with a
 * scripted fake runner. No real agents, no network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";
import { openDatabase } from "../src/store/index.js";

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

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

type App = Awaited<ReturnType<typeof createApp>>;

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

async function waitForTurnSettled(ctx: App["ctx"], id: string, annotationId: string): Promise<void> {
  await waitFor(() => {
    const s = ctx.reviews.getSnapshot(id);
    const a = s?.annotations.find((x) => x.id === annotationId) as unknown as
      | { working: string | null; turns?: { working: string | null }[] }
      | undefined;
    return a?.working == null && (a?.turns ?? []).every((t) => t.working == null);
  }, 60000);
}

/** Fake that parks the explain turn on a gate, then fails mid-stream. */
function gatedFailingRunner(gate: { release: () => void; promise: Promise<void> }): FakeAgentRunner {
  let release!: () => void;
  gate.promise = new Promise<void>((r) => {
    release = r;
  });
  gate.release = release;
  class Gated extends FakeAgentRunner {
    override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
      if (text.includes("## The question\n\nExplain this.")) {
        this.prompts.push({ sessionId: session.id, text });
        await gate.promise;
        yield {
          type: "text",
          delta: "Partial answer start [[diff:conn:80-82]] and more.\n\n```json\n{}\n```\n",
        };
        yield { type: "error", message: "boom mid-stream", retryable: false };
        return;
      }
      yield* super.prompt(session, text);
    }
  }
  return new Gated([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
  ]);
}

describe("stuck writing turns (#272)", () => {
  it("a fill that fails while its card is closed records the failure", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const gate: { release: () => void; promise: Promise<void> } = {
      release: () => {},
      promise: Promise.resolve(),
    };
    const { app, ctx } = await createApp("tok", { agents: gatedFailingRunner(gate) });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      const ask = await postAction(app, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ask.status).toBe(200);
      const annotationId = ask.json.annotationId as string;
      const jobId = ask.json.jobId as string;
      await waitFor(() => ctx.jobs.get(jobId) !== undefined);

      // Close the card mid-fill, then fail the turn.
      const closed = await postAction(app, id, { kind: "close", annotationId });
      expect(closed.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)?.open).toBe(false);
      gate.release();
      expect(await waitForJob(ctx, jobId)).toBe("error");
      await waitForTurnSettled(ctx, id, annotationId);

      // The failure is recorded despite the closed card: no stuck
      // working flag, no partial answer, banner state set.
      const snap = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const turn = (snap.turns ?? [])[0]!;
      expect(turn.working).toBeNull();
      expect(turn.error).toBe("boom mid-stream");
      expect(turn.blocks).toEqual([]);
      expect(snap.error).toBe("boom mid-stream");

      // Retry works from the failed turn and reopens the card.
      const retry = await postAction(app, id, { kind: "retry", annotationId });
      expect(retry.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("an explicitly cancelled fill settles quietly with nothing stuck", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const gate: { release: () => void; promise: Promise<void> } = {
      release: () => {},
      promise: Promise.resolve(),
    };
    const agents = gatedFailingRunner(gate);
    agents.addScript({
      match: "Anchor problem",
      events: textEvents(`The host block is described here.\n\n\`\`\`json\n{}\n\`\`\`\n`),
    });
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      const ask = await postAction(app, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      const annotationId = ask.json.annotationId as string;
      const jobId = ask.json.jobId as string;
      await waitFor(() => ctx.jobs.get(jobId) !== undefined);

      // Cancel the fill the way the Debug page does, then let the parked
      // turn observe the abort.
      const cancelled = await app.inject({
        method: "POST",
        url: `/api/jobs/${jobId}/cancel`,
        headers: authed,
      } as never);
      expect(cancelled.statusCode).toBe(200);
      gate.release();
      expect(await waitForJob(ctx, jobId)).toBe("cancelled");
      await waitForTurnSettled(ctx, id, annotationId);

      // Quiet: no banner — but no working flag, job link or partials.
      const snap = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const turn = (snap.turns ?? [])[0]!;
      expect(turn.working).toBeNull();
      expect(turn.jobId).toBeUndefined();
      expect(turn.blocks).toEqual([]);
      expect(turn.error).toBeFalsy();
      expect(snap.working).toBeNull();
      expect(snap.error).toBeFalsy();

      // Nothing failed, so there is nothing to retry — in plain words.
      const retry = await postAction(app, id, { kind: "retry", annotationId });
      expect(retry.status).toBe(400);
      expect(String((retry.json as { error?: string }).error ?? "")).not.toContain("ann_");
    } finally {
      await app.close();
    }
  });

  it("a graceful-shutdown-cancelled fill is marked failed on next boot", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-272-data-"));
    const dbPath = path.join(dir, "unvibe.db");
    const gate: { release: () => void; promise: Promise<void> } = {
      release: () => {},
      promise: Promise.resolve(),
    };
    const db1 = openDatabase(dbPath);
    const { app: app1, ctx: ctx1 } = await createApp("tok", {
      agents: gatedFailingRunner(gate),
      db: db1,
      dataDir: dir,
    });
    try {
      const created = await app1.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitFor(
        () => !!ctx1.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length,
      );
      const ask = await postAction(app1, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      const annotationId = ask.json.annotationId as string;
      const jobId = ask.json.jobId as string;
      await waitFor(() => ctx1.jobs.get(jobId) !== undefined);

      // Graceful shutdown cancels the open fill and persists it; the
      // parked turn never settles in the old process.
      ctx1.jobs.shutdown();
      expect(ctx1.jobs.get(jobId)?.state).toBe("cancelled");

      // Next boot on the same database: the stuck turn is settled as
      // interrupted instead of sticking on "Writing" forever.
      const db2 = openDatabase(dbPath);
      const { app: app2, ctx: ctx2 } = await createApp("tok", {
        agents: new FakeAgentRunner([
          { match: "reply with exactly", events: textEvents("ready") },
          { match: "# Reader task", events: textEvents(MINIMAL_READER) },
          {
            match: "## The question",
            events: textEvents("Clean answer after restart.\n\n```json\n{}\n```\n"),
          },
        ]),
        db: db2,
        dataDir: dir,
      });
      try {
        const snap = ctx2.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
        const turn = (snap.turns ?? [])[0]!;
        expect(turn.working).toBeNull();
        expect(turn.error).toMatch(/stopped because the service restarted/);
        expect(turn.blocks).toEqual([]);

        // Retry refills the turn with a clean answer.
        const retry = await postAction(app2, id, { kind: "retry", annotationId });
        expect(retry.status).toBe(200);
        expect(await waitForJob(ctx2, retry.json.jobId as string)).toBe("done");
        await waitForTurnSettled(ctx2, id, annotationId);
        const after = ctx2.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
        const retried = (after.turns ?? [])[0]!;
        expect(retried.error).toBeFalsy();
        expect(JSON.stringify(retried.blocks)).toContain("Clean answer after restart.");
      } finally {
        await app2.close();
        try {
          db2.close();
        } catch {
          // Best effort.
        }
      }
    } finally {
      // Leave app1's turn parked: releasing the gate would settle its
      // run against the shared database after the assertions. Closing
      // never awaits the parked run, and the bare deferred gate holds
      // no timer, so nothing leaks. (app2 is closed by the inner
      // finally; its db too.)
      await app1.close().catch(() => {});
      try {
        db1.close();
      } catch {
        // Best effort.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
