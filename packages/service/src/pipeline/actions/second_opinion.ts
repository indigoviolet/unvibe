/**
 * `second_opinion` action (PRD §4.10).
 *
 * Runs a second-opinion on any card or finding via the isolated
 * `secondopinion/` module (own L0 + L1 base, never a fork of the main
 * base; blind vs check modes; result attached to the card). The job runs
 * at user priority, is cancellable, dedupes by (card, mode, model,
 * version), and stores its prompt snapshot for Settings → Jobs.
 */
import type { ReviewSnapshot, SecondOpinionMode } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import type { SecondOpinionDeps } from "../../secondopinion/index.js";
import { requestSecondOpinion, removeSecondOpinion } from "../../secondopinion/index.js";

function depsFromPipeline(pipeline: Pipeline): SecondOpinionDeps {
  const opts = (pipeline as unknown as { opts: SecondOpinionDeps }).opts;
  return opts;
}

export async function secondOpinionAction(
  pipeline: Pipeline,
  _jobs: JobQueue,
  _reviews: ReviewStore,
  reviewId: string,
  cardId: string,
  mode: SecondOpinionMode,
): Promise<{ jobId?: string; reused?: boolean }> {
  const deps = depsFromPipeline(pipeline);
  const res = await requestSecondOpinion(deps, { reviewId, cardId, mode });
  if ("reused" in res) return { reused: true };
  return { jobId: res.id };
}

export async function removeSecondOpinionAction(
  pipeline: Pipeline,
  jobs: JobQueue,
  reviews: ReviewStore,
  reviewId: string,
  cardId: string,
  mode?: SecondOpinionMode,
  opinionId?: string,
): Promise<{ removed: boolean }> {
  const deps = depsFromPipeline(pipeline);
  // Remove means gone, even with a re-run in flight (issue #76): cancel
  // the run first so its late result cannot resurrect the block. The
  // runner additionally drops a result whose job was aborted before it
  // could store, covering a cancel that lands past the last stream.
  cancelSecondOpinionJobs(jobs, reviews, reviewId, cardId, mode, opinionId);
  await removeSecondOpinion({ reviews: deps.reviews }, reviewId, cardId, mode, opinionId);
  return { removed: true };
}

/**
 * Cancel active second-opinion jobs whose result would land on the removed
 * opinion. Jobs dedupe by `card:<requestCard>|second-opinion:<mode>|…`, so
 * match that prefix; a finding-page request stores on its cards, so a
 * card-addressed removal also matches the hosting page's prefix (and vice
 * versa). Opinion-id-addressed removals resolve card+mode from the stored
 * result first; with nothing stored there is no run to cancel (removal of
 * a never-stored opinion throws below).
 */
function cancelSecondOpinionJobs(
  jobs: JobQueue,
  reviews: ReviewStore,
  reviewId: string,
  cardId: string,
  mode: SecondOpinionMode | undefined,
  opinionId: string | undefined,
): void {
  let anchorCard = cardId;
  let wantMode = mode;
  const snapshot = reviews.getSnapshot(reviewId);
  if (opinionId && (!anchorCard || !wantMode)) {
    const found = findOpinionInSnapshot(snapshot, opinionId);
    if (!found) return;
    anchorCard = found.cardId;
    wantMode = found.mode;
  }
  if (!anchorCard || !wantMode) return;
  const anchors = new Set([`card:${anchorCard}`]);
  const page = snapshot?.pages.find((p) => p.id === anchorCard && p.kind === "finding");
  if (page) {
    for (const c of page.cards) anchors.add(`card:${c.id}`);
  } else {
    const host = snapshot?.pages.find((p) => p.kind === "finding" && p.cards.some((c) => c.id === anchorCard));
    if (host) anchors.add(`card:${host.id}`);
  }
  for (const j of jobs.listByReview(reviewId)) {
    if (j.kind !== "second-opinion") continue;
    if (j.state === "done" || j.state === "error" || j.state === "cancelled") continue;
    const key = j.dedupeKey ?? "";
    const hit = [...anchors].some((a) => key.startsWith(`${a}|second-opinion:${wantMode}|`));
    if (!hit) continue;
    try {
      jobs.cancel(j.id);
    } catch {
      // Already settled between the list and the cancel: nothing to do.
    }
  }
}

/** Stored result for an opinion id, with the card it is attached to. */
function findOpinionInSnapshot(
  snapshot: ReviewSnapshot | null | undefined,
  opinionId: string,
): { cardId: string; mode: SecondOpinionMode } | null {
  if (!snapshot) return null;
  for (const a of snapshot.annotations) {
    if (a.type !== "conversation") continue;
    for (const t of a.turns ?? []) {
      const hit = (t.secondOpinions ?? []).find((s) => s.id === opinionId);
      if (hit) return { cardId: t.id, mode: hit.mode };
    }
  }
  for (const p of snapshot.pages) {
    for (const c of p.cards) {
      const hit = (c.secondOpinions ?? []).find((s) => s.id === opinionId);
      if (hit) return { cardId: c.id, mode: hit.mode };
    }
  }
  return null;
}
