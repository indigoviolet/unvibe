/**
 * `UNVIBE_AGENT=none`: the pipeline is disabled (comments/diff/versions
 * specs), so no background job mutates the review and no fixture content
 * lands on non-fixture repos.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { createAgentRunner, isNoneEnv, isNoneRunner, isReplayEnv } from "../src/agent/factory.js";
import { NO_AGENT_MESSAGE, NoAgentRunner } from "../src/agent/none.js";
import { createApp } from "../src/server.js";

function makeSnapshot(): ReviewSnapshot {
  return {
    review: { id: "rv_none", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  } as unknown as ReviewSnapshot;
}

describe("UNVIBE_AGENT=none", () => {
  it("factory selects the none runner only for UNVIBE_AGENT=none", () => {
    expect(isNoneEnv({ UNVIBE_AGENT: "none" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isNoneEnv({ UNVIBE_AGENT: "NONE" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isNoneEnv({ UNVIBE_AGENT: "replay" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isNoneEnv({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isReplayEnv({ UNVIBE_AGENT: "none" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isNoneRunner(createAgentRunner({ env: { UNVIBE_AGENT: "none" } as NodeJS.ProcessEnv }))).toBe(
      true,
    );
    expect(
      isNoneRunner(createAgentRunner({ env: { UNVIBE_AGENT: "replay" } as NodeJS.ProcessEnv })),
    ).toBe(false);
  });

  it("every agent call fails fast with a clear message", async () => {
    const runner = new NoAgentRunner();
    await expect(runner.start({} as never)).rejects.toThrow(NO_AGENT_MESSAGE);
    await expect(runner.load("s")).rejects.toThrow(NO_AGENT_MESSAGE);
    await expect(runner.prompt({} as never, "hi").next()).rejects.toThrow(NO_AGENT_MESSAGE);
    await expect(runner.close({} as never)).rejects.toThrow(NO_AGENT_MESSAGE);
  });

  it("startReview and resumeReview enqueue nothing and leave the snapshot alone", async () => {
    const { ctx } = await createApp("tok", { agents: new NoAgentRunner() });
    try {
      ctx.reviews.putSnapshot("rv_none", makeSnapshot());
      await ctx.pipeline.startReview("rv_none");
      const resumed = await ctx.pipeline.resumeReview("rv_none");
      // Let any fire-and-forget pipeline work settle.
      await new Promise((r) => setTimeout(r, 200));
      expect(ctx.jobs.listByReview("rv_none")).toHaveLength(0);
      expect(resumed.jobIds).toEqual([]);
      expect(ctx.reviews.getSnapshot("rv_none")?.rev).toBe(1);
      expect(ctx.reviews.getSnapshot("rv_none")?.pages).toEqual([]);
    } finally {
      ctx.db.close();
    }
  });
});
