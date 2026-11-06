/**
 * Issue #354: removing a review while its guide is building crashes the
 * service. `DELETE /api/reviews/:id` returns 200; seconds later a running
 * job settles, `JobQueue.settle` calls `JobStore.save`, which throws
 * `FOREIGN KEY constraint failed`, and the process exits on the unhandled
 * rejection from the fire-and-forget `execute`.
 *
 * All with the fake AgentRunner — never a real agent.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_PRIORITY, type Job } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { FakeRandom, ManualClock } from "../src/jobs/clock.js";
import { JobQueue } from "../src/jobs/queue.js";
import { JobStore, type JobPersistence } from "../src/jobs/store.js";
import { deleteReviewLocal } from "../src/reviews/delete.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks/macrotasks so detached executes settle. */
async function flush(n = 30): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function makeDb(): import("node:sqlite").DatabaseSync {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

/** The scaffold `jobs` table FKs to `reviews(id)`; seed a stub review. */
function seedReview(db: import("node:sqlite").DatabaseSync, reviewId: string): void {
  db.prepare("INSERT OR IGNORE INTO repos (id, owner, name, local_path) VALUES ('repo1', 'o', 'n', '/tmp')").run();
  db.prepare(
    "INSERT OR IGNORE INTO reviews (id, repo_id, branch, created_at) VALUES (?, 'repo1', 'b', 0)",
  ).run(reviewId);
}

const stubRunner = {
  run: async () => ({ stdout: "", stderr: "", code: 0 }),
};

function jobRows(db: import("node:sqlite").DatabaseSync, reviewId: string): Job[] {
  return new JobStore(db).listByReview(reviewId);
}

describe("#354 removing a review mid-run", () => {
  it("a cancelled job settling after the delete saves nothing and throws nothing", async () => {
    const rejections: unknown[] = [];
    const onRejection = (err: unknown): void => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const db = makeDb();
      seedReview(db, "r1");
      // Lazily created in production (sharedctx/store.ts); the delete
      // touches it unconditionally.
      db.exec("CREATE TABLE IF NOT EXISTS sharedctx_bases (review_id TEXT)");
      const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-354-"));
      const gone = new Set<string>();
      const queue = new JobQueue({
        clock: new ManualClock(),
        random: new FakeRandom([0.5]),
        getConcurrencyCap: () => 4,
        onEvent: () => {},
        persist: new JobStore(db),
        isReviewGone: (id) => gone.has(id),
      });
      // A run that ignores the abort signal (like a mid-turn agent call):
      // it finishes after the delete and settles.
      const gate = deferred();
      const job = queue.enqueue({
        reviewId: "r1",
        kind: "ask",
        provider: "p",
        model: "m",
        effort: "",
        priority: JOB_PRIORITY.background,
        run: async () => {
          await gate.promise;
        },
      });
      // The route's remove path: cancel first, delete rows, drop entries.
      queue.cancel(job.id);
      const res = await deleteReviewLocal(
        {
          db,
          runner: stubRunner,
          dataDir,
          cancelJobs: (reviewId) => {
            for (const j of queue.listByReview(reviewId)) {
              if (j.state !== "done" && j.state !== "error" && j.state !== "cancelled") queue.cancel(j.id);
            }
          },
        },
        "r1",
      );
      expect(res.deleted).toBe(true);
      gone.add("r1");
      queue.dropReview("r1");
      gate.resolve();
      await flush();
      await queue.drain(5000).catch(() => {});
      expect(jobRows(db, "r1")).toEqual([]);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("a running (uncancelled) job settling after its review is gone stops quietly", async () => {
    const rejections: unknown[] = [];
    const onRejection = (err: unknown): void => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const db = makeDb();
      seedReview(db, "r1");
      const gone = new Set<string>();
      const queue = new JobQueue({
        clock: new ManualClock(),
        random: new FakeRandom([0.5]),
        getConcurrencyCap: () => 4,
        onEvent: () => {},
        persist: new JobStore(db),
        isReviewGone: (id) => gone.has(id),
      });
      const gate = deferred();
      queue.enqueue({
        reviewId: "r1",
        kind: "ask",
        provider: "p",
        model: "m",
        effort: "",
        priority: JOB_PRIORITY.background,
        run: async () => {
          await gate.promise;
        },
      });
      // Rows vanish while the run is still in flight (no cancel: the
      // abort raced the agent turn, exactly the reported crash).
      db.prepare("DELETE FROM jobs WHERE review_id = ?").run("r1");
      db.prepare("DELETE FROM reviews WHERE id = ?").run("r1");
      gone.add("r1");
      gate.resolve();
      await flush();
      expect(jobRows(db, "r1")).toEqual([]);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("a store error inside settle is contained and the service keeps answering", async () => {
    const rejections: unknown[] = [];
    const onRejection = (err: unknown): void => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const { app, ctx } = await createApp("tok", { agents: new FakeAgentRunner() });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(created.statusCode).toBe(201);
        const id = (created.json() as { review: { id: string } }).review.id;
        // Hold a job mid-run, then remove the review under it.
        const gate = deferred();
        const job = ctx.jobs.enqueue({
          reviewId: id,
          kind: "ask",
          provider: "p",
          model: "m",
          effort: "",
          priority: JOB_PRIORITY.background,
          run: async () => {
            await gate.promise;
          },
        });
        const removed = await app.inject({ method: "DELETE", url: `/api/reviews/${id}`, headers: authed } as never);
        expect(removed.statusCode).toBe(200);
        gate.resolve();
        await flush();
        // The service is still up: start page data + another review works.
        const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed } as never);
        expect(list.statusCode).toBe(200);
        expect(
          ((list.json() as { reviews: { id: string }[] }).reviews ?? []).some((r) => r.id === id),
        ).toBe(false);
        const reopened = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId: "demo" },
        } as never);
        expect(reopened.statusCode).toBe(201);
        expect(rejections).toEqual([]);
        expect(job.id).toBeTruthy();
      } finally {
        await app.close();
      }
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("a throwing store marks the in-memory job failed without exiting", async () => {
    const rejections: unknown[] = [];
    const onRejection = (err: unknown): void => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const db = makeDb();
      seedReview(db, "r1");
      const real = new JobStore(db);
      // Fail only after enqueue: enqueue itself must still surface a
      // store failure to its caller (#221, #276); containment applies
      // to saves inside a running job (#354).
      let failSaves = false;
      const broken: JobPersistence = {
        save: (job) => {
          if (failSaves) throw new Error("boom: disk gone");
          real.save(job);
        },
        get: (id) => real.get(id),
        listByReview: (reviewId) => real.listByReview(reviewId),
        listOpen: () => real.listOpen(),
        listAll: () => real.listAll(),
      };
      const queue = new JobQueue({
        clock: new ManualClock(),
        random: new FakeRandom([0.5]),
        getConcurrencyCap: () => 4,
        onEvent: () => {},
        persist: broken,
      });
      const failing = queue.enqueue({
        reviewId: "r1",
        kind: "ask",
        provider: "p",
        model: "m",
        effort: "",
        priority: JOB_PRIORITY.background,
        run: async () => {
          throw new Error("turn failed");
        },
      });
      failSaves = true;
      await flush();
      expect(queue.get(failing.id)?.state).toBe("error");
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
