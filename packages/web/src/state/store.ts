/**
 * Global review state: one zustand store holding the review snapshot,
 * updated by snapshot fetch + WS state patches (RFC 6902 ops, see
 * `packages/shared/src/api.ts` for the contract).
 *
 * Ordering (the live-pipeline race fix): the service serialises mutations
 * per review, so patches form a strict chain
 * `rev N --(baseRev N)--> N+1 --(baseRev N+1)--> N+2 …`. The client applies
 * a patch only against its exact `baseRev`:
 * - `baseRev === rev` → apply, then drain any queued patches that now chain;
 * - `baseRev < rev` → stale/duplicate (already in the snapshot): drop;
 * - `baseRev > rev` → a patch was missed (stale fetch clobbered newer
 *   state, patches arrived before the first snapshot, or the socket
 *   dropped): queue the patch and raise `resyncSeq` so the route refetches
 *   the snapshot. The refetch converges on confirmed server state and the
 *   queue drains (queued patches already covered by the fresh snapshot are
 *   dropped by `headRev`).
 *
 * Snapshots are rev-gated too: a fetch that started earlier must never
 * clobber newer WS state (`incoming.rev < rev` is ignored; equal revs are
 * accepted so live job lists stay fresh).
 */
import { create } from "zustand";
import type { Job, ReviewEvent, ReviewSnapshot, StatePatchOp } from "@unvibe/shared";

type PatchEvent = Extract<ReviewEvent, { type: "patch" }>;

/** Cap on queued out-of-order patches (a gap refetch converges instead). */
const MAX_PENDING = 200;

interface ReviewState {
  snapshot: ReviewSnapshot | null;
  connected: boolean;
  /**
   * Streamed text per card or thread (`text` events carry `cardId` and/or
   * `threadId`). Cards show the tail as progress while their job runs;
   * threads show it under the working indicator; patches/snapshots
   * materialize the content and clear the streams.
   */
  streams: Record<string, string>;
  /** Out-of-order patches waiting for their `baseRev`. */
  pending: PatchEvent[];
  /**
   * Incremented whenever a patch gap needs a server resync. `ReviewRoute`
   * refetches the snapshot on change; the fresh snapshot drains `pending`.
   */
  resyncSeq: number;
  setSnapshot: (snapshot: ReviewSnapshot) => void;
  setConnected: (connected: boolean) => void;
  applyEvent: (event: ReviewEvent) => void;
  updateJob: (job: Job) => void;
  clear: () => void;
}

function unescapePointer(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Apply one RFC 6902 op (add/remove/replace) at a JSON Pointer path.
 * Throws on out-of-bounds array indices or missing intermediate objects so
 * a corrupt patch triggers a resync instead of silently corrupting state.
 */
export function applyOp(root: unknown, op: StatePatchOp): unknown {
  const segs = op.path.split("/").slice(1).map(unescapePointer);
  if (segs.length === 0) {
    if (op.op === "remove") return undefined;
    return (op as { value: unknown }).value;
  }
  // Clone-on-write along the path.
  const clone = (v: unknown): unknown =>
    Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...(v as object) } : v;
  const newRoot = clone(root);
  let node: Record<string, unknown> & unknown[] = newRoot as never;
  for (let i = 0; i < segs.length - 1; i++) {
    if (node === null || typeof node !== "object") {
      throw new Error(`patch parent missing at ${op.path}`);
    }
    const key = segs[i];
    const next = (node as Record<string, unknown>)[key];
    const copy = clone(next);
    (node as Record<string, unknown>)[key] = copy;
    node = copy as never;
  }
  if (node === null || typeof node !== "object") {
    throw new Error(`patch parent missing at ${op.path}`);
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(node)) {
    const idx = last === "-" ? node.length : Number(last);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`patch array index out of bounds at ${op.path}`);
    }
    if (op.op === "remove") {
      if (idx >= node.length) throw new Error(`patch array index out of bounds at ${op.path}`);
      node.splice(idx, 1);
    } else if (op.op === "add") {
      if (idx > node.length) throw new Error(`patch array index out of bounds at ${op.path}`);
      node.splice(idx, 0, (op as { value: unknown }).value);
    } else {
      if (idx >= node.length) throw new Error(`patch array index out of bounds at ${op.path}`);
      node[idx] = (op as { value: unknown }).value;
    }
  } else {
    const obj = node as Record<string, unknown>;
    if (op.op === "remove") delete obj[last];
    else obj[last] = (op as { value: unknown }).value;
  }
  return newRoot;
}

function applyPatchOps(snapshot: ReviewSnapshot, event: PatchEvent): ReviewSnapshot {
  let root: unknown = snapshot;
  for (const op of event.ops) root = applyOp(root, op);
  return { ...(root as ReviewSnapshot), rev: event.headRev };
}

/**
 * Drain queued patches against `snapshot`: drop patches the snapshot
 * already covers (`headRev <= rev`), apply the longest chain starting at
 * `rev`, keep the rest. Returns the snapshot, the leftover queue, and
 * whether a gap remains (caller raises `resyncSeq`).
 */
function drainPending(
  snapshot: ReviewSnapshot,
  pending: PatchEvent[],
): { snapshot: ReviewSnapshot; pending: PatchEvent[]; gap: boolean } {
  const covered = pending.filter((p) => p.headRev > snapshot.rev);
  const rest = [...covered].sort((a, b) => a.baseRev - b.baseRev || a.headRev - b.headRev);
  let cur = snapshot;
  let progressed = true;
  while (progressed) {
    progressed = false;
    const idx = rest.findIndex((p) => p.baseRev === cur.rev);
    if (idx < 0) break;
    const [next] = rest.splice(idx, 1);
    try {
      cur = applyPatchOps(cur, next);
    } catch {
      // Corrupt patch: drop it and let the resync converge.
      break;
    }
    progressed = true;
  }
  const gap = rest.length > 0 && !rest.some((p) => p.baseRev === cur.rev);
  return { snapshot: cur, pending: rest, gap };
}

function queuePatch(pending: PatchEvent[], event: PatchEvent): PatchEvent[] {
  if (pending.some((p) => p.baseRev === event.baseRev && p.headRev === event.headRev)) {
    return pending;
  }
  const next = [...pending, event];
  return next.length > MAX_PENDING ? next.slice(next.length - MAX_PENDING) : next;
}

export const useReview = create<ReviewState>()((set) => ({
  snapshot: null,
  connected: false,
  streams: {},
  pending: [],
  resyncSeq: 0,
  setSnapshot: (snapshot) =>
    set((s) => {
      // A stale fetch must never clobber newer WS state. Equal revs are
      // accepted (live job lists merge into the snapshot without a bump).
      if (s.snapshot && snapshot.rev < s.snapshot.rev) return s;
      const drained = drainPending(snapshot, s.pending);
      return {
        snapshot: drained.snapshot,
        pending: drained.pending,
        resyncSeq: drained.gap ? s.resyncSeq + 1 : s.resyncSeq,
      };
    }),
  setConnected: (connected) => set({ connected }),
  applyEvent: (event) =>
    set((s) => {
      switch (event.type) {
        case "snapshot": {
          const snapshot = event.snapshot;
          if (s.snapshot && snapshot.rev < s.snapshot.rev) return s;
          const drained = drainPending(snapshot, s.pending);
          return {
            snapshot: drained.snapshot,
            streams: {},
            pending: drained.pending,
            resyncSeq: drained.gap ? s.resyncSeq + 1 : s.resyncSeq,
          };
        }
        case "patch": {
          if (!s.snapshot) {
            // Before the first snapshot: queue until the fetch lands.
            return { pending: queuePatch(s.pending, event) };
          }
          if (event.baseRev === s.snapshot.rev) {
            let applied: ReviewSnapshot;
            try {
              applied = applyPatchOps(s.snapshot, event);
            } catch {
              return { pending: queuePatch(s.pending, event), resyncSeq: s.resyncSeq + 1 };
            }
            const drained = drainPending(applied, s.pending);
            return {
              snapshot: drained.snapshot,
              streams: {},
              pending: drained.pending,
              resyncSeq: drained.gap ? s.resyncSeq + 1 : s.resyncSeq,
            };
          }
          if (event.baseRev < s.snapshot.rev) return s; // stale duplicate: drop
          return { pending: queuePatch(s.pending, event), resyncSeq: s.resyncSeq + 1 };
        }
        case "job": {
          if (!s.snapshot) return s;
          const jobs = s.snapshot.jobs.map((j) => (j.id === event.job.id ? event.job : j));
          return { snapshot: { ...s.snapshot, jobs } };
        }
        case "text": {
          const key = event.threadId ?? event.cardId;
          if (!key) return s;
          const prev = s.streams[key] ?? "";
          return { streams: { ...s.streams, [key]: (prev + event.delta).slice(-4000) } };
        }
        default:
          return s; // error handled by streaming views later
      }
    }),
  updateJob: (job) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, jobs: s.snapshot.jobs.map((j) => (j.id === job.id ? job : j)) } }
        : s,
    ),
  clear: () => set({ snapshot: null, streams: {}, pending: [], resyncSeq: 0 }),
}));
