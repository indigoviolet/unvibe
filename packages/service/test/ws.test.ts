/**
 * WS `/api/events?review=:id`: authenticated streaming from the review's
 * bus, tested with a real `ws` client against a listening server.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ReviewEvent, ReviewSnapshot } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

function emptySnapshot(id: string): ReviewSnapshot {
  return {
    review: { id, repoId: "rp_x", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
}

describe("WS events", () => {
  it("streams patch events to an authenticated client", async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", {runner: new RealCommandRunner(), autoPipeline: false});
    ctx.reviews.putSnapshot("rv_ws", emptySnapshot("rv_ws"));
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as AddressInfo).port;
    try {
      const received: ReviewEvent[] = [];
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events?review=rv_ws&token=tok`);
      await new Promise<void>((resolve, reject) => {
        socket.on("open", () => resolve());
        socket.on("error", reject);
      });
      socket.on("message", (data) => {
        received.push(JSON.parse(String(data)) as ReviewEvent);
      });

      // A hunk PATCH goes through ReviewStore.mutate → bus → socket.
      const patched = await app.inject({
        method: "PATCH",
        url: "/api/reviews/rv_ws/hunks/abc123",
        headers: { authorization: "Bearer tok" },
        payload: { reviewed: true },
      });
      expect(patched.statusCode).toBe(200);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for patch")), 3000);
        const check = (): void => {
          if (received.length > 0) {
            clearTimeout(timer);
            resolve();
          } else {
            setTimeout(check, 25);
          }
        };
        check();
      });

      expect(received).toHaveLength(1);
      const event = received[0];
      expect(event.type).toBe("patch");
      if (event.type === "patch") {
        expect(event.baseRev).toBe(1);
        expect(event.headRev).toBe(2);
        expect(event.ops.length).toBeGreaterThan(0);
      }
      socket.close();
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated sockets", async () => {
    const { app } = await createApp("tok", {runner: new RealCommandRunner(), autoPipeline: false});
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as AddressInfo).port;
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events?review=rv_ws`);
      const outcome = await new Promise<string>((resolve) => {
        socket.on("open", () => resolve("opened"));
        socket.on("error", (err) => resolve(`error: ${err.message}`));
        setTimeout(() => resolve("timeout"), 3000);
      });
      expect(outcome).toMatch(/401|error|timeout/);
      expect(outcome).not.toBe("opened");
      socket.close();
    } finally {
      await app.close();
    }
  });
});
