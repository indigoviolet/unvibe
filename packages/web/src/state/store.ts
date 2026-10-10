/**
 * Global review state: one zustand store holding the review snapshot,
 * updated by snapshot fetch + WS state patches (RFC 6902 ops, see
 * `packages/shared/src/api.ts` for the contract).
 */
import { create } from "zustand";
import type { Job, ReviewEvent, ReviewSnapshot, StatePatchOp } from "@unvibe/shared";

interface ReviewState {
  snapshot: ReviewSnapshot | null;
  connected: boolean;
  setSnapshot: (snapshot: ReviewSnapshot) => void;
  setConnected: (connected: boolean) => void;
  applyEvent: (event: ReviewEvent) => void;
  updateJob: (job: Job) => void;
  clear: () => void;
}

function unescapePointer(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Apply one RFC 6902 op (add/remove/replace) at a JSON Pointer path. */
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
    const key = segs[i];
    const next = (node as Record<string, unknown>)[key];
    const copy = clone(next);
    (node as Record<string, unknown>)[key] = copy;
    node = copy as never;
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(node)) {
    const idx = last === "-" ? node.length : Number(last);
    if (op.op === "remove") node.splice(idx, 1);
    else if (op.op === "add") node.splice(idx, 0, (op as { value: unknown }).value);
    else node[idx] = (op as { value: unknown }).value;
  } else {
    const obj = node as Record<string, unknown>;
    if (op.op === "remove") delete obj[last];
    else obj[last] = (op as { value: unknown }).value;
  }
  return newRoot;
}

export const useReview = create<ReviewState>()((set) => ({
  snapshot: null,
  connected: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  setConnected: (connected) => set({ connected }),
  applyEvent: (event) =>
    set((s) => {
      if (!s.snapshot) return s;
      switch (event.type) {
        case "snapshot":
          return { snapshot: event.snapshot };
        case "patch": {
          if (event.baseRev !== s.snapshot.rev) return s; // drifted: wait for resync
          let root: unknown = s.snapshot;
          for (const op of event.ops) root = applyOp(root, op);
          return { snapshot: { ...(root as ReviewSnapshot), rev: event.headRev } };
        }
        case "job": {
          const jobs = s.snapshot.jobs.map((j) => (j.id === event.job.id ? event.job : j));
          return { snapshot: { ...s.snapshot, jobs } };
        }
        default:
          return s; // text/error handled by streaming views later
      }
    }),
  updateJob: (job) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, jobs: s.snapshot.jobs.map((j) => (j.id === job.id ? job : j)) } }
        : s,
    ),
  clear: () => set({ snapshot: null }),
}));
