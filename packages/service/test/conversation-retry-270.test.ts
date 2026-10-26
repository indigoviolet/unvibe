/**
 * Ask follow-up failures + Retry (issue #270).
 *
 * - A failed turn leaves no partial answer behind: the card shows the
 *   banner plus Retry, and the raw output stays on the job for Debug.
 * - Retry refills the failed turn in place and never concatenates the
 *   failed output with the new one — even when the failed turn is not
 *   the last one on the card.
 * - A malformed trailing block fails the turn (banner plus Retry) with
 *   the raw reply and the error on the job.
 * - Retrying a conversation with nothing failed refuses in plain words
 *   with no internal ids (the toast copy).
 *
 * Through the real stack (live HTTP + job queue + store) with a
 * scripted fake runner. No real agents, no network.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
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

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

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
  await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
  return { app, ctx, id };
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

async function waitForTurnSettled(ctx: App["ctx"], id: string, annotationId: string): Promise<void> {
  await waitFor(() => {
    const s = ctx.reviews.getSnapshot(id);
    const a = s?.annotations.find((x) => x.id === annotationId) as unknown as
      | { working: string | null; turns?: { working: string | null }[] }
      | undefined;
    return a?.working == null && (a?.replies ?? []).every((t) => t.working == null);
  }, 60000);
}

describe("failed ask turns + retry (#270)", () => {
  it("a failed follow-up then a retry: banner state matches, no concatenation", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    let calls = 0;
    class Flake extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (text.includes("connflake followup")) {
          calls += 1;
          this.prompts.push({ sessionId: session.id, text });
          if (calls === 1) {
            // Fail mid-stream, after partial text: the partial must not
            // survive on the turn.
            yield {
              type: "text",
              delta: "Partial answer start [[diff:conn:80-82]] and more.\n\n```json\n{}\n```\n",
            };
            yield { type: "error", message: "boom mid-stream", retryable: false };
            return;
          }
          yield* textEvents("Clean retry answer here.\n\n```json\n{}\n```\n");
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new Flake([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "# Ask", events: textEvents("First answer body.\n\n```json\n{}\n```\n") },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
        message: "first?",
      });
      expect(ask.status).toBe(200);
      const annotationId = ask.json.annotationId as string;
      await waitForJob(ctx, ask.json.jobId as string);
      await waitForTurnSettled(ctx, id, annotationId);

      const rep = await postAction(app, id, {
        kind: "reply",
        annotationId,
        message: "connflake followup?",
      });
      expect(rep.status).toBe(200);
      const turnId = rep.json.turnId as string;
      expect(await waitForJob(ctx, rep.json.jobId as string)).toBe("error");
      await waitForTurnSettled(ctx, id, annotationId);

      // The banner state: the turn carries the error, and no partial
      // answer (cut-off citation or trailing block) survives on it.
      const failed = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const failedTurn = (failed.replies ?? []).find((t) => t.id === turnId)!;
      expect(failedTurn.error).toBe("boom mid-stream");
      expect(failedTurn.blocks).toEqual([]);
      // The raw output and the error stay on the job for the Debug page.
      expect(ctx.jobs.get(rep.json.jobId as string)?.replySnapshot).toContain("Partial answer start");
      expect(ctx.jobs.get(rep.json.jobId as string)?.error).toContain("boom mid-stream");

      // Retry refills the same turn and succeeds with a clean answer.
      const retry = await postAction(app, id, { kind: "retry", annotationId });
      expect(retry.status).toBe(200);
      expect(retry.json.turnId).toBe(turnId);
      expect(await waitForJob(ctx, retry.json.jobId as string)).toBe("done");
      await waitForTurnSettled(ctx, id, annotationId);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const retried = (after.replies ?? []).find((t) => t.id === turnId)!;
      expect(retried.error).toBeFalsy();
      // No concatenation: only the new answer is stored.
      expect(JSON.stringify(retried.blocks)).toContain("Clean retry answer here.");
      expect(JSON.stringify(retried.blocks)).not.toContain("Partial answer start");

      // Nothing failed anymore: a further retry refuses in plain words
      // with no internal id (the toast copy).
      const again = await postAction(app, id, { kind: "retry", annotationId });
      expect(again.status).toBe(400);
      const message = (again.json as { error?: string }).error ?? "";
      expect(message).toContain("no failed reply");
      expect(message).not.toContain("ann_");
      expect(message).not.toContain(annotationId);
    } finally {
      await app.close();
    }
  });

  it("a malformed trailing block fails the turn with the raw reply on the job", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "## The question",
        events: textEvents("Answer body here [[diff:conn:80-82]].\n\n```json\n{bad json\n```\n"),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const ask = await postAction(app, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ask.status).toBe(200);
      const annotationId = ask.json.annotationId as string;
      const jobId = ask.json.jobId as string;
      expect(await waitForJob(ctx, jobId)).toBe("error");
      await waitForTurnSettled(ctx, id, annotationId);
      const snap = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const turn = (snap.replies ?? [])[0]!;
      // Banner plus Retry: the turn carries the error, no partial card.
      expect(turn.error).toMatch(/expected format/);
      expect(turn.blocks).toEqual([]);
      // Raw output and error on the job for the Debug page.
      expect(ctx.jobs.get(jobId)?.replySnapshot).toContain("Answer body here");
      expect(ctx.jobs.get(jobId)?.error).toMatch(/expected format/);

      // Retry works from the banner.
      const retry = await postAction(app, id, { kind: "retry", annotationId });
      expect(retry.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("retry refills a failed turn that is not the last one", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    let firstCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    class OverlapFake extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (text.includes("first followup")) {
          firstCalls += 1;
          this.prompts.push({ sessionId: session.id, text });
          if (firstCalls === 1) {
            // Block mid-turn so a second follow-up lands first.
            await gate;
            yield { type: "text", delta: "First partial answer.\n\n```json\n{}\n```\n" };
            yield { type: "error", message: "first failed late", retryable: false };
            return;
          }
          yield* textEvents("First retried answer.\n\n```json\n{}\n```\n");
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new OverlapFake([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      // First match wins, and every ask prompt contains "# Ask" — so the
      // message-specific script must come first.
      { match: "second followup", events: textEvents("Second answer body.\n\n```json\n{}\n```\n") },
      { match: "# Ask", events: textEvents("First answer body.\n\n```json\n{}\n```\n") },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
        message: "first?",
      });
      const annotationId = ask.json.annotationId as string;
      await waitForJob(ctx, ask.json.jobId as string);
      await waitForTurnSettled(ctx, id, annotationId);

      // Turn 1 starts and blocks; turn 2 is pushed while turn 1 fills.
      const rep1 = await postAction(app, id, { kind: "reply", annotationId, message: "first followup?" });
      expect(rep1.status).toBe(200);
      const turn1 = rep1.json.turnId as string;
      await waitFor(() => agents.prompts.some((p) => p.text.includes("first followup")));
      const rep2 = await postAction(app, id, { kind: "reply", annotationId, message: "second followup?" });
      expect(rep2.status).toBe(200);
      const turn2 = rep2.json.turnId as string;
      expect(await waitForJob(ctx, rep2.json.jobId as string)).toBe("done");

      // Turn 1 now fails behind the settled turn 2.
      release();
      expect(await waitForJob(ctx, rep1.json.jobId as string)).toBe("error");
      await waitForTurnSettled(ctx, id, annotationId);
      const snap = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect((snap.replies ?? []).map((t) => t.id)).toContain(turn1);
      expect((snap.replies ?? []).map((t) => t.id).indexOf(turn1)).toBeLessThan(
        (snap.replies ?? []).map((t) => t.id).indexOf(turn2),
      );
      expect((snap.replies ?? []).find((t) => t.id === turn1)!.error).toBe("first failed late");

      // Retry works from the failed (non-last) turn's banner: it refills
      // turn 1 and leaves turn 2 untouched.
      const retry = await postAction(app, id, { kind: "retry", annotationId });
      expect(retry.status).toBe(200);
      expect(retry.json.turnId).toBe(turn1);
      expect(await waitForJob(ctx, retry.json.jobId as string)).toBe("done");
      await waitForTurnSettled(ctx, id, annotationId);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const t1 = (after.replies ?? []).find((t) => t.id === turn1)!;
      const t2 = (after.replies ?? []).find((t) => t.id === turn2)!;
      expect(t1.error).toBeFalsy();
      expect(JSON.stringify(t1.blocks)).toContain("First retried answer.");
      expect(JSON.stringify(t2.blocks)).toContain("Second answer body.");
    } finally {
      await app.close();
    }
  });
});
