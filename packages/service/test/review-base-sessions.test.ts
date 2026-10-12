/**
 * Base sessions belong to one review (#43).
 *
 * Every new review starts at v1 with the same guide revision, so the base
 * key must carry the review id: a second review never picks up the first
 * one's agent session, and a review removed and added again starts from a
 * new session.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };
const BASE_PACK = "Read the base context below";

async function waitFor(check: () => boolean, timeoutMs = 10000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function agents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: BASE_PACK, events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
    { match: "", events: [{ type: "done", stopReason: "end_turn" }] },
  ]);
}

/** Session ids that received a base pack, in order. */
function baseSessions(runner: FakeAgentRunner): string[] {
  return runner.prompts.filter((p) => p.text.includes(BASE_PACK)).map((p) => p.sessionId);
}

describe("base sessions are per review", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  async function createDemo(app: Awaited<ReturnType<typeof createApp>>["app"]): Promise<string> {
    const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } });
    expect(created.statusCode).toBe(201);
    return (created.json() as ReviewSnapshot).review.id;
  }

  it("two reviews of the same change each build their own base", async () => {
    const runner = agents();
    const { app } = await createApp("tok", { agents: runner });
    try {
      await createDemo(app);
      await waitFor(() => baseSessions(runner).length >= 1);
      await createDemo(app);
      await waitFor(() => new Set(baseSessions(runner)).size >= 2);
    } finally {
      await app.close();
    }
  });

  it("a review removed and added again starts from a new base session", async () => {
    const runner = agents();
    const { app, ctx } = await createApp("tok", { agents: runner });
    try {
      const first = await createDemo(app);
      await waitFor(() => baseSessions(runner).length >= 1);
      const firstBase = baseSessions(runner)[0]!;

      const removed = await app.inject({ method: "DELETE", url: `/api/reviews/${first}`, headers: authed });
      expect(removed.statusCode).toBe(200);
      // Remove forgets the review's sessions: no base is left to reuse.
      expect(ctx.sessions.baseKeys().filter((k) => k.startsWith(`${first}|`))).toEqual([]);

      const second = await createDemo(app);
      expect(second).not.toBe(first);
      await waitFor(() => baseSessions(runner).some((id) => id !== firstBase));
      expect(ctx.sessions.baseKeys().every((k) => !k.startsWith(`${first}|`))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
