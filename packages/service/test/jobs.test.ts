/**
 * Deterministic job-queue tests (PRD §12): fake clock + fake random, no
 * timers, no agents.
 */
import { describe, expect, it } from "vitest";
import { JOB_PRIORITY, jobDedupeKeyString, type Job, type ReviewEvent } from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { computeBackoffDelay } from "../src/jobs/backoff.js";
import { FakeRandom, ManualClock } from "../src/jobs/clock.js";
import { RetryableError } from "../src/jobs/errors.js";
import { INTERRUPTED_MESSAGE, JobQueue, type JobContext } from "../src/jobs/queue.js";
import { JobStore } from "../src/jobs/store.js";

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
async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

interface Harness {
  queue: JobQueue;
  clock: ManualClock;
  events: ReviewEvent[];
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

function makeQueue(
  opts: {
    cap?: number | ((provider: string) => number);
    maxAttempts?: number;
    baseMs?: number;
    maxMs?: number;
    rand?: number[];
    persist?: boolean;
  } = {},
): Harness & { store?: JobStore } {
  const clock = new ManualClock();
  const events: ReviewEvent[] = [];
  let store: JobStore | undefined;
  if (opts.persist) {
    const db = makeDb();
    seedReview(db, "r1");
    store = new JobStore(db);
  }
  const queue = new JobQueue({
    clock,
    random: new FakeRandom(opts.rand ?? [0.5]),
    maxAttempts: opts.maxAttempts ?? 3,
    backoffBaseMs: opts.baseMs ?? 1000,
    backoffMaxMs: opts.maxMs ?? 8000,
    getConcurrencyCap: typeof opts.cap === "function" ? opts.cap : () => opts.cap ?? 4,
    onEvent: (_review, e) => events.push(e),
    persist: store ?? null,
  });
  return { queue, clock, events, store };
}

const spec = (over: Partial<Parameters<JobQueue["enqueue"]>[0]> = {}) => ({
  reviewId: "r1",
  kind: "explain" as const,
  provider: "claude",
  model: "m",
  effort: "",
  priority: JOB_PRIORITY.background,
  run: async () => {},
  ...over,
});

describe("back-off schedule", () => {
  it("is exponential with jitter (pure function)", () => {
    expect(computeBackoffDelay(0, 1000, 8000, 0.5)).toBe(1500);
    expect(computeBackoffDelay(1, 1000, 8000, 0.5)).toBe(2500);
    expect(computeBackoffDelay(2, 1000, 8000, 0.5)).toBe(4500);
    expect(computeBackoffDelay(10, 1000, 8000, 0.5)).toBe(8500);
    expect(computeBackoffDelay(10, 1000, 8000, 0)).toBe(8000);
  });
});

describe("concurrency cap", () => {
  it("never runs more than the per-provider cap", async () => {
    const { queue } = makeQueue({ cap: 2 });
    let running = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
    for (const g of gates) {
      queue.enqueue(
        spec({
          run: async () => {
            running += 1;
            peak = Math.max(peak, running);
            await g.promise;
            running -= 1;
          },
        }),
      );
    }
    await flush();
    expect(peak).toBe(2);
    expect(running).toBe(2);
    gates[0].resolve();
    gates[1].resolve();
    await flush();
    expect(peak).toBe(2);
    for (const g of gates) g.resolve();
    await queue.drain();
    expect(running).toBe(0);
  });

  it("caps apply per provider independently", async () => {
    const { queue } = makeQueue({ cap: 1 });
    const gates = [deferred(), deferred()];
    queue.enqueue(spec({ provider: "a", run: ( ) => gates[0].promise.then(() => {}) }));
    queue.enqueue(spec({ provider: "b", run: () => gates[1].promise.then(() => {}) }));
    await flush();
    expect(queue.get(queue.listByReview("r1")[0].id)?.state).toBe("running");
    expect(queue.get(queue.listByReview("r1")[1].id)?.state).toBe("running");
    gates[0].resolve();
    gates[1].resolve();
    await queue.drain();
  });

  it("#123: small-model jobs run in their own bucket, never behind main jobs", async () => {
    const { queue } = makeQueue({ cap: 1 });
    const mainGate = deferred();
    queue.enqueue(spec({ kind: "critic", run: () => mainGate.promise.then(() => {}) }));
    const smallGates = [deferred(), deferred()];
    const small = smallGates.map((g) =>
      queue.enqueue(spec({ kind: "hunk-pass", run: () => g.promise.then(() => {}) })),
    );
    await flush();
    // The main slot is full, yet both hunk jobs still run.
    expect(queue.get(small[0].id)?.state).toBe("running");
    expect(queue.get(small[1].id)?.state).toBe("running");
    // The small bucket still caps itself: a fifth small job waits while four run.
    const extraGates = [deferred(), deferred(), deferred()];
    const extra = extraGates.map((g) =>
      queue.enqueue(spec({ kind: "hunk-pass", run: () => g.promise.then(() => {}) })),
    );
    await flush();
    expect(queue.get(extra[0].id)?.state).toBe("running");
    expect(queue.get(extra[1].id)?.state).toBe("running");
    expect(queue.get(extra[2].id)?.state).toBe("queued");
    for (const g of [...smallGates, ...extraGates]) g.resolve();
    mainGate.resolve();
    await queue.drain();
  });
});

describe("priority", () => {
  it("starts queued jobs highest-priority-first, FIFO within a band", async () => {
    let cap = 0;
    const { queue } = makeQueue({ cap: () => cap });
    const started: string[] = [];
    const mk = (name: string, priority: number) =>
      queue.enqueue(spec({ priority, run: async () => void started.push(name) }));
    const low1 = mk("low1", JOB_PRIORITY.background);
    const user = mk("user", JOB_PRIORITY.userRequested);
    const vis = mk("vis", JOB_PRIORITY.visible);
    const low2 = mk("low2", JOB_PRIORITY.background);
    expect([low1, user, vis, low2].map((j) => j.state)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    cap = 10;
    queue.setPriority(low1.id, JOB_PRIORITY.background); // no change, just re-pumps
    await queue.drain();
    expect(started).toEqual(["user", "vis", "low1", "low2"]);
  });

  it("re-prioritisation takes effect while queued", async () => {
    let cap = 0;
    const { queue } = makeQueue({ cap: () => cap });
    const started: string[] = [];
    const a = queue.enqueue(spec({ priority: JOB_PRIORITY.background, run: async () => void started.push("a") }));
    queue.enqueue(spec({ priority: JOB_PRIORITY.visible, run: async () => void started.push("b") }));
    queue.setPriority(a.id, JOB_PRIORITY.userRequested);
    expect(queue.get(a.id)?.priority).toBe(JOB_PRIORITY.userRequested);
    cap = 10;
    queue.setPriority(a.id, JOB_PRIORITY.userRequested);
    await queue.drain();
    expect(started).toEqual(["a", "b"]);
  });
});

describe("back-off and retry", () => {
  it("backs off with the deterministic schedule, then fails terminally", async () => {
    const { queue, clock, events } = makeQueue({ maxAttempts: 3, rand: [0.5] });
    let runs = 0;
    const job = queue.enqueue(
      spec({
        run: async () => {
          runs += 1;
          throw new RetryableError("rate limited");
        },
      }),
    );
    await flush();
    expect(runs).toBe(1);
    let cur = queue.get(job.id)!;
    expect(cur.state).toBe("backing-off");
    expect(cur.error).toBe("rate limited");
    expect(cur.nextRetryAt).toBe(1500);

    await clock.advance(1500);
    await flush();
    expect(runs).toBe(2);
    cur = queue.get(job.id)!;
    expect(cur.state).toBe("backing-off");
    expect(cur.nextRetryAt).toBe(1500 + 2500);

    await clock.advance(2500);
    await flush();
    expect(runs).toBe(3);
    cur = queue.get(job.id)!;
    expect(cur.state).toBe("error");
    expect(cur.attempts).toBe(3);

    const states = events.filter((e) => e.type === "job").map((e) => (e as { job: Job }).job.state);
    expect(states).toContain("backing-off");
    expect(states[states.length - 1]).toBe("error");
  });

  it("a non-retryable throw fails immediately", async () => {
    const { queue } = makeQueue();
    const job = queue.enqueue(
      spec({
        run: async () => {
          throw new Error("boom");
        },
      }),
    );
    await flush();
    const cur = queue.get(job.id)!;
    expect(cur.state).toBe("error");
    expect(cur.error).toBe("boom");
  });

  it("retry() reruns a failed job under the same id", async () => {
    const { queue } = makeQueue();
    let runs = 0;
    const job = queue.enqueue(
      spec({
        run: async () => {
          runs += 1;
          if (runs === 1) throw new Error("first fails");
        },
      }),
    );
    await flush();
    expect(queue.get(job.id)?.state).toBe("error");
    queue.retry(job.id);
    await queue.drain();
    expect(runs).toBe(2);
    const cur = queue.get(job.id)!;
    expect(cur.state).toBe("done");
    expect(cur.id).toBe(job.id);
  });
});

describe("cancellation", () => {
  it("cancels while queued without running", async () => {
    let cap = 0;
    const { queue } = makeQueue({ cap: () => cap });
    let ran = false;
    const job = queue.enqueue(spec({ run: async () => void (ran = true) }));
    expect(queue.get(job.id)?.state).toBe("queued");
    queue.cancel(job.id);
    expect(queue.get(job.id)?.state).toBe("cancelled");
    cap = 10;
    queue.setPriority(job.id, JOB_PRIORITY.userRequested);
    await flush();
    expect(ran).toBe(false);
  });

  it("aborts a running job; the abort wins over a late success", async () => {
    const { queue } = makeQueue();
    const gate = deferred();
    let seenAborted = false;
    const job = queue.enqueue(
      spec({
        run: async (ctx: JobContext) => {
          ctx.signal.addEventListener("abort", () => (seenAborted = true));
          await gate.promise;
        },
      }),
    );
    await flush();
    expect(queue.get(job.id)?.state).toBe("running");
    queue.cancel(job.id);
    expect(queue.get(job.id)?.state).toBe("cancelled");
    gate.resolve();
    await flush();
    expect(seenAborted).toBe(true);
    expect(queue.get(job.id)?.state).toBe("cancelled");
  });

  it("cancels while backing off (no further retries)", async () => {
    const { queue, clock } = makeQueue({ maxAttempts: 5 });
    let runs = 0;
    const job = queue.enqueue(
      spec({
        run: async () => {
          runs += 1;
          throw new RetryableError("slow down");
        },
      }),
    );
    await flush();
    expect(queue.get(job.id)?.state).toBe("backing-off");
    queue.cancel(job.id);
    expect(queue.get(job.id)?.state).toBe("cancelled");
    await clock.advance(60_000);
    await flush();
    expect(runs).toBe(1);
  });
});

describe("dedupe", () => {
  it("identical requests share one job/result", async () => {
    const { queue } = makeQueue();
    const gate = deferred();
    let secondRuns = 0;
    const dedupe = { anchor: "card:c1", requestKind: "explain", depth: "standard", baseVersion: "v1" };
    const first = queue.enqueue(spec({ dedupe, run: (ctx) => gate.promise.then(() => ctx.reportText("hi")) }));
    const second = queue.enqueue(spec({ dedupe, run: async () => void secondRuns++ }));
    expect(second.id).toBe(first.id);
    gate.resolve();
    await queue.drain();
    expect(secondRuns).toBe(0);
    expect(queue.get(first.id)?.state).toBe("done");
  });

  it("different depths do not dedupe", async () => {
    const { queue } = makeQueue();
    const a = queue.enqueue(
      spec({ dedupe: { anchor: "x", requestKind: "depth", depth: "simple", baseVersion: "v1" } }),
    );
    const b = queue.enqueue(
      spec({ dedupe: { anchor: "x", requestKind: "depth", depth: "deep", baseVersion: "v1" } }),
    );
    expect(a.id).not.toBe(b.id);
    await queue.drain();
  });
});

describe("usage, prompts and events", () => {
  it("accumulates usage, computes the read share as the hit rate, streams text with card id", async () => {
    const { queue, events } = makeQueue();
    const job = queue.enqueue(
      spec({
        cardId: "c-central",
        promptSnapshot: "PROMPT",
        run: async (ctx) => {
          ctx.reportUsage({ inputTokens: 100, cachedReadTokens: 30, cachedWriteTokens: 10, outputTokens: 10 });
          ctx.reportUsage({ inputTokens: 100, cachedReadTokens: 90, cachedWriteTokens: 0, outputTokens: 10 });
          ctx.reportText("hello");
          ctx.setSessionId("s-1");
        },
      }),
    );
    await queue.drain();
    const cur = queue.get(job.id)!;
    expect(cur.usage).toEqual({ inputTokens: 200, cachedReadTokens: 120, cachedWriteTokens: 10, outputTokens: 20 });
    // Read share = read/(input+read+write) (#125; M0 pitfall #2: input
    // counts uncached input only, so cached/input can exceed 1).
    expect(cur.cacheHitRate).toBeCloseTo(120 / 330);
    expect(cur.sessionId).toBe("s-1");
    expect(cur.promptSnapshot).toBe("PROMPT");
    const texts = events.filter((e) => e.type === "text");
    expect(texts).toEqual([{ type: "text", jobId: job.id, cardId: "c-central", delta: "hello" }]);
  });

  it("a turn with writes and no reads shows 0 % (#125)", async () => {
    const { queue } = makeQueue();
    const job = queue.enqueue(
      spec({
        run: async (ctx) => {
          ctx.reportUsage({ inputTokens: 100, cachedReadTokens: 0, cachedWriteTokens: 900, outputTokens: 10 });
        },
      }),
    );
    await queue.drain();
    const cur = queue.get(job.id)!;
    expect(cur.usage).toEqual({ inputTokens: 100, cachedReadTokens: 0, cachedWriteTokens: 900, outputTokens: 10 });
    expect(cur.cacheHitRate).toBe(0);
  });
});

describe("card scope (#62)", () => {
  it("carries cardId on the job: enqueue return, get, listByReview and job events", async () => {
    const { queue, events } = makeQueue();
    const job = queue.enqueue(spec({ cardId: "c-central", run: async () => {} }));
    expect(job.cardId).toBe("c-central");
    expect(queue.get(job.id)?.cardId).toBe("c-central");
    expect(queue.listByReview("r1").find((j) => j.id === job.id)?.cardId).toBe("c-central");
    await queue.drain();
    const seen = events.filter((e) => e.type === "job" && e.job.id === job.id);
    expect(seen.length).toBeGreaterThan(0);
    for (const e of seen) {
      if (e.type === "job") expect(e.job.cardId).toBe("c-central");
    }
    // Jobs without a card carry no cardId key at all.
    const plain = queue.enqueue(spec({ run: async () => {} }));
    await queue.drain();
    expect("cardId" in queue.get(plain.id)!).toBe(false);
  });

  it("persists cardId across save and restart recovery", async () => {
    const db = makeDb();
    seedReview(db, "r1");
    const store = new JobStore(db);
    const q1 = new JobQueue({ clock: new ManualClock(), persist: store });
    const gate = deferred();
    const running = q1.enqueue(
      spec({ reviewId: "r1", cardId: "c-central", run: () => gate.promise.then(() => {}) }),
    );
    await flush();
    expect(store.get(running.id)?.cardId).toBe("c-central");

    const q2 = new JobQueue({ clock: new ManualClock(), persist: store });
    const { interrupted } = q2.recover(store.listOpen());
    expect(interrupted[0].cardId).toBe("c-central");
    gate.resolve();
  });

  it("carries effort on the job and persists it (#172); Default is stored as empty", async () => {
    const { queue, store } = makeQueue({ persist: true });
    const job = queue.enqueue(spec({ reviewId: "r1", effort: "high", run: async () => {} }));
    expect(job.effort).toBe("high");
    expect(queue.get(job.id)?.effort).toBe("high");
    expect(store?.get(job.id)?.effort).toBe("high");
    const plain = queue.enqueue(spec({ reviewId: "r1", run: async () => {} }));
    expect(queue.get(plain.id)?.effort).toBe("");
    await queue.drain();
  });
});

describe("persistence and restart recovery", () => {
  it("persists jobs so the view survives; open jobs come back interrupted, never blocking re-enqueue", async () => {
    const db = makeDb();
    seedReview(db, "r1");
    const store = new JobStore(db);
    const q1 = new JobQueue({ clock: new ManualClock(), persist: store });
    const gate = deferred();
    const running = q1.enqueue(
      spec({ reviewId: "r1", promptSnapshot: "P", run: () => gate.promise.then(() => {}) }),
    );
    await flush();
    expect(q1.get(running.id)?.state).toBe("running");
    expect(store.listByReview("r1").map((j) => j.id)).toContain(running.id);
    expect(store.get(running.id)?.promptSnapshot).toBe("P");

    // Simulate a restart: new queue over the same store.
    const q2 = new JobQueue({ clock: new ManualClock(), persist: store });
    const { interrupted, orphaned } = q2.recover(store.listOpen());
    expect(interrupted.map((j) => j.id)).toEqual([running.id]);
    expect(interrupted[0].state).toBe("error");
    expect(interrupted[0].error).toBe(INTERRUPTED_MESSAGE);
    expect(orphaned).toEqual([]);

    // Interrupted jobs can be retried (rebind a fresh run).
    gate.resolve(); // let the old process's run go; its queue is gone
    q2.retry(running.id, async () => {});
    await q2.drain();
    expect(q2.get(running.id)?.state).toBe("done");
  });

  it("queued jobs come back interrupted (never orphaned): a resume re-enqueues fresh work", async () => {    const db = makeDb();
    seedReview(db, "r9");
    const store = new JobStore(db);
    const key = { anchor: "guide", requestKind: "reader", baseVersion: "v1" };
    store.save({
      id: "q-1",
      kind: "ask",
      model: "m",
      provider: "claude",
      reviewId: "r9",
      priority: 10,
      state: "queued",
      dedupeKey: jobDedupeKeyString(key),
    });
    const q2 = new JobQueue({ clock: new ManualClock(), persist: store });
    const { interrupted, orphaned } = q2.recover(store.listOpen());
    expect(orphaned).toEqual([]);
    expect(interrupted.map((j) => j.id)).toEqual(["q-1"]);
    expect(interrupted[0].error).toBe(INTERRUPTED_MESSAGE);
    // The dead job's dedupe key is freed: re-enqueueing the same request
    // starts fresh work instead of attaching to the dead job.
    let ran = false;
    const fresh = q2.enqueue({
      reviewId: "r9",
      kind: "ask",
      provider: "claude",
      model: "m",
      priority: 10,
      dedupe: key,
      run: async () => void (ran = true),
    });
    expect(fresh.id).not.toBe("q-1");
    await q2.drain();
    expect(ran).toBe(true);
  });

  it("finished jobs stay listed after a restart; open ones come back interrupted (issue #117)", async () => {
    const db = makeDb();
    seedReview(db, "r1");
    const store = new JobStore(db);
    const q1 = new JobQueue({ clock: new ManualClock(), persist: store });
    const finished = q1.enqueue(
      spec({ reviewId: "r1", promptSnapshot: "P", annotationId: "t-1", run: async () => {} }),
    );
    await q1.drain();
    expect(q1.get(finished.id)?.state).toBe("done");
    const gateOpen = deferred();
    const gateCancel = deferred();
    const open = q1.enqueue(spec({ reviewId: "r1", run: () => gateOpen.promise.then(() => {}) }));
    const willCancel = q1.enqueue(spec({ reviewId: "r1", run: () => gateCancel.promise.then(() => {}) }));
    await flush();
    expect(q1.get(open.id)?.state).toBe("running");
    q1.cancel(willCancel.id);
    gateCancel.resolve();

    // SIGKILL: abandon q1; the next queue hydrates every stored job.
    const q2 = new JobQueue({ clock: new ManualClock(), persist: store });
    const { interrupted, orphaned } = q2.recover(store.listAll());
    expect(interrupted.map((j) => j.id)).toEqual([open.id]);
    expect(interrupted[0].error).toBe(INTERRUPTED_MESSAGE);
    expect(orphaned).toEqual([]);
    gateOpen.resolve(); // let the dead process's run go; its queue is gone

    const listed = q2.listByReview("r1");
    expect(new Map(listed.map((j) => [j.id, j.state]))).toEqual(
      new Map([
        [finished.id, "done"],
        [open.id, "error"],
        [willCancel.id, "cancelled"],
      ]),
    );
    // Lists stay small (no prompt snapshots); single gets keep them.
    expect(listed.find((j) => j.id === finished.id)?.promptSnapshot).toBeUndefined();
    expect(q2.get(finished.id)?.promptSnapshot).toBe("P");
    // annotationId survives, so finished ask jobs still match their cards.
    expect(q2.get(finished.id)?.annotationId).toBe("t-1");
    // Hydrated jobs never count as active, never execute, never block exit.
    expect(q2.activeCount()).toBe(0);
    expect(q2.listActive()).toEqual([]);
    await q2.drain();
    // A hydrated finished job retries under the same id with a fresh run.
    q2.retry(finished.id, async () => {});
    await q2.drain();
    expect(q2.get(finished.id)?.state).toBe("done");
  });

  it("listByReview omits prompt snapshots (single get keeps them)", async () => {
    const db = makeDb();
    seedReview(db, "r1");
    const store = new JobStore(db);
    const q = new JobQueue({ persist: store });
    const job = q.enqueue(
      spec({ reviewId: "r1", promptSnapshot: "P".repeat(1000), run: async () => {} }),
    );
    await q.drain();
    expect(q.listByReview("r1")).toHaveLength(1);
    expect(q.listByReview("r1")[0].promptSnapshot).toBeUndefined();
    expect(q.get(job.id)?.promptSnapshot).toBe("P".repeat(1000));
  });
});
