/**
 * ReviewStore: patch-op correctness, durability across reopen, event
 * emission, per-review serialisation, no-op elision.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot, StatePatchOp } from "@unvibe/shared";
import { EventBus } from "../src/events.js";
import { ReviewStore } from "../src/state/store.js";
import { migrate, openDatabase } from "../src/store/index.js";

function unescape(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Minimal RFC 6902 apply (mirrors the web store's `applyOp`). */
function applyOp(root: unknown, op: StatePatchOp): unknown {
  const segs = op.path.split("/").slice(1).map(unescape);
  const clone = (v: unknown): unknown =>
    Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...(v as object) } : v;
  if (segs.length === 0) {
    return op.op === "remove" ? undefined : (op as { value: unknown }).value;
  }
  const next = clone(root);
  let node = next as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const copy = clone(node[segs[i]]) as Record<string, unknown>;
    node[segs[i]] = copy;
    node = copy;
  }
  const last = segs[segs.length - 1];
  if (op.op === "remove") delete node[last];
  else node[last] = (op as { value: unknown }).value;
  return next;
}

function applyOps(root: unknown, ops: StatePatchOp[]): unknown {
  return ops.reduce<unknown>((acc, op) => applyOp(acc, op), root);
}

function makeSnapshot(rev = 1): ReviewSnapshot {
  return {
    review: {
      id: "rv_test",
      repoId: "rp_test",
      branch: "feature",
      versions: [],
      currentVersion: 1,
      createdAt: 0,
    },
    version: {
      n: 1,
      headSha: "abc",
      mergeBaseSha: "def",
      baseRef: "main",
      fetchedAt: 0,
      idMapping: {},
    },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev,
    ingest: { status: "ready" },
  };
}

describe("ReviewStore", () => {
  it("mutate bumps rev, emits exact ops, and publishes a patch event", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const bus = new EventBus();
    const store = new ReviewStore(db, bus);
    store.putSnapshot("rv_test", makeSnapshot(1));

    const seen: unknown[] = [];
    bus.subscribe("rv_test", (e) => seen.push(e));

    const before = store.getSnapshot("rv_test");
    const res = await store.mutate("rv_test", (draft) => {
      draft.hunkStates.push({ contentHash: "deadbeef", folded: false, reviewed: true });
    });

    expect(res.baseRev).toBe(1);
    expect(res.headRev).toBe(2);
    expect(res.ops.length).toBeGreaterThan(0);
    expect(store.getSnapshot("rv_test")?.rev).toBe(2);

    // Ops applied to the old snapshot reproduce the new one exactly.
    const replayed = applyOps(structuredClone(before), res.ops) as ReviewSnapshot;
    replayed.rev = res.headRev;
    expect(replayed).toEqual(res.snapshot);

    // One patch event on the review's bus with matching revs/ops.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ type: "patch", baseRev: 1, headRev: 2, ops: res.ops });
    db.close();
  });

  it("persists across reopen (restart loses nothing)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-state-"));
    const file = path.join(dir, "unvibe.db");
    {
      const db = openDatabase(file);
      migrate(db);
      const store = new ReviewStore(db, new EventBus());
      store.putSnapshot("rv_test", makeSnapshot(1));
      await store.mutate("rv_test", (draft) => {
        draft.hunkStates.push({ contentHash: "aa", folded: true, reviewed: false });
      });
      db.close();
    }
    {
      const db = openDatabase(file);
      migrate(db);
      const store = new ReviewStore(db, new EventBus());
      const snap = store.getSnapshot("rv_test");
      expect(snap?.rev).toBe(2);
      expect(snap?.hunkStates).toEqual([{ contentHash: "aa", folded: true, reviewed: false }]);
      const res = await store.mutate("rv_test", (draft) => {
        draft.hunkStates[0].reviewed = true;
      });
      expect(res.baseRev).toBe(2);
      expect(res.headRev).toBe(3);
      db.close();
    }
  });

  it("serialises concurrent mutations per review", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = new ReviewStore(db, new EventBus());
    store.putSnapshot("rv_test", makeSnapshot(1));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.mutate("rv_test", (draft) => {
          draft.hunkStates.push({ contentHash: `h${i}`, folded: false, reviewed: false });
        }),
      ),
    );
    const headRevs = results.map((r) => r.headRev).sort((a, b) => a - b);
    expect(headRevs).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const snap = store.getSnapshot("rv_test");
    expect(snap?.rev).toBe(11);
    expect(snap?.hunkStates).toHaveLength(10);
    db.close();
  });

  it("elides no-op mutations (no bump, no write, no event)", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const bus = new EventBus();
    const store = new ReviewStore(db, bus);
    store.putSnapshot("rv_test", makeSnapshot(1));
    const events: unknown[] = [];
    bus.subscribe("rv_test", (e) => events.push(e));
    const res = await store.mutate("rv_test", () => {});
    expect(res.ops).toEqual([]);
    expect(res.baseRev).toBe(1);
    expect(res.headRev).toBe(1);
    expect(events).toHaveLength(0);
    expect(store.getSnapshot("rv_test")?.rev).toBe(1);
    db.close();
  });

  it("rejects unknown reviews and returns null snapshots", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = new ReviewStore(db, new EventBus());
    expect(store.getSnapshot("nope")).toBeNull();
    await expect(store.mutate("nope", () => {})).rejects.toThrow(/unknown review/);
    db.close();
  });
});
