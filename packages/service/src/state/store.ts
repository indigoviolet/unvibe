/**
 * ReviewStore: durable per-review snapshots with revisioned patches.
 *
 * The piece every later milestone builds on. Contract for other agents:
 *
 * ```ts
 * const store = new ReviewStore(db, bus);
 * store.putSnapshot(reviewId, snapshot);          // create (rev 1) / replace
 * store.getSnapshot(reviewId);                    // ReviewSnapshot | null
 * await store.mutate(reviewId, (draft) => {       // edit a draft; atomic
 *   draft.hunkStates.push({ contentHash, folded: false, reviewed: true });
 * });
 * // → { baseRev, headRev, ops, snapshot }; publishes
 * //   { type: "patch", baseRev, headRev, ops } on the review's bus.
 * ```
 *
 * Guarantees:
 * - `mutate` bumps `rev` by exactly 1 per non-empty change, computes the
 *   RFC 6902 ops for exactly what changed (immer patches → JSON Pointer),
 *   persists the new snapshot + rev in SQLite inside one transaction, and
 *   publishes the patch event only after the commit.
 * - Mutations are serialised per review (a promise chain): concurrent
 *   `mutate` calls apply in order, each seeing the previous one's result.
 *   No-op recipes (zero patches) skip the write, the bump, and the publish.
 * - A service restart loses nothing: snapshots + revs live in the
 *   `review_snapshots` table; reopening the DB restores them verbatim.
 */
import { enablePatches, produceWithPatches, type WritableDraft } from "immer";
import type { ReviewSnapshot, StatePatchOp } from "@unvibe/shared";
import type { EventBus } from "../events.js";
import { transaction, type DatabaseSync } from "../store/index.js";
import { immerPatchesToOps } from "./patch.js";

// Immer's patch plugin is opt-in; every mutate below needs it.
enablePatches();

/** Recipe editing a draft of the snapshot (immer draft; return void). */
export type SnapshotRecipe = (draft: WritableDraft<ReviewSnapshot>) => void;

export interface MutateResult {
  baseRev: number;
  headRev: number;
  ops: StatePatchOp[];
  snapshot: ReviewSnapshot;
}

export class ReviewStore {
  /** Per-review serialisation chains (reviewId → tail promise). */
  private tails = new Map<string, Promise<void>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly bus: EventBus,
  ) {}

  /** Latest durable snapshot, or null when the review is unknown. */
  getSnapshot(reviewId: string): ReviewSnapshot | null {
    const row = this.db
      .prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?")
      .get(reviewId) as { rev: number; snapshot: string } | undefined;
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot) as ReviewSnapshot;
    snapshot.rev = row.rev;
    return snapshot;
  }

  /**
   * Create (or wholesale replace) a review's snapshot. The snapshot's own
   * `rev` is used (normalised to ≥ 1). Prefer `mutate` for updates so
   * subscribers get patches.
   */
  putSnapshot(reviewId: string, snapshot: ReviewSnapshot): void {
    const rev = snapshot.rev >= 1 ? Math.floor(snapshot.rev) : 1;
    const stored: ReviewSnapshot = { ...snapshot, rev };
    transaction(this.db, () => {
      this.db
        .prepare(
          "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot, updated_at = excluded.updated_at",
        )
        .run(reviewId, rev, JSON.stringify(stored), Date.now());
    });
  }

  /**
   * Atomically apply a recipe to the snapshot. Serialised per review;
   * resolves with the new snapshot + the exact patch ops published.
   * Rejects with `unknown review <id>` when no snapshot exists.
   */
  mutate(reviewId: string, recipe: SnapshotRecipe): Promise<MutateResult> {
    const prev = this.tails.get(reviewId) ?? Promise.resolve();
    const cur = prev.then(() => this.applyMutate(reviewId, recipe));
    const tail = cur.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(reviewId, tail);
    void tail.then(() => {
      if (this.tails.get(reviewId) === tail) this.tails.delete(reviewId);
    });
    return cur;
  }

  private applyMutate(reviewId: string, recipe: SnapshotRecipe): MutateResult {
    const row = this.db
      .prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?")
      .get(reviewId) as { rev: number; snapshot: string } | undefined;
    if (!row) throw new Error(`unknown review ${reviewId}`);
    const baseRev = row.rev;
    const before = JSON.parse(row.snapshot) as ReviewSnapshot;
    before.rev = baseRev;

    const [next, patches] = produceWithPatches(before, recipe);
    if (patches.length === 0) {
      return { baseRev, headRev: baseRev, ops: [], snapshot: before };
    }
    const headRev = baseRev + 1;
    const snapshot: ReviewSnapshot = { ...next, rev: headRev };
    const ops = immerPatchesToOps(patches);

    transaction(this.db, () => {
      this.db
        .prepare("UPDATE review_snapshots SET rev = ?, snapshot = ?, updated_at = ? WHERE review_id = ?")
        .run(headRev, JSON.stringify(snapshot), Date.now(), reviewId);
    });

    // Publish only after the durable commit.
    this.bus.publish(reviewId, { type: "patch", baseRev, headRev, ops });
    return { baseRev, headRev, ops, snapshot };
  }
}
