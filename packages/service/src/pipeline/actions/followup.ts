/**
 * `followup` action (PRD §4.3): clicking a follow-up suggestion adds its
 * answer under it.
 *
 * The suggestion item is consumed (removed from the follow-up block, as
 * in the prototype's `follow`) and its answer arrives as an expansion
 * anchored on that block, quoting the suggestion label. The message sent
 * is the item's pre-baked `ask` question when present, else the label.
 */
import type { WritableDraft } from "immer";
import type { Annotation, Block, FollowUpBlock, Job, ReviewSnapshot } from "@unvibe/shared";
import { JOB_PRIORITY, dedupeBlockIds } from "@unvibe/shared";
import { recordInteraction } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { newAnnotationId } from "../../comments/threads.js";
import {
  baseVersionOf,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  l4VariablesWithRevealed,
  type ActionContext,
} from "./common.js";
import { aliasCanonicalizer, remapAliasTargets } from "./validate-apply.js";
import { newCardForExpansion } from "./events.js";

export async function followupAction(
  ctx: ActionContext,
  cardId: string,
  blockId: string,
  index: number,
): Promise<{ annotationId: string; jobId?: string; deduplicated?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);

  // Locate the follow-up block + item (page cards and expansions).
  const located = findFollowUp(snapshot, cardId, blockId);
  if (!located) throw new Error(`unknown follow-up block ${blockId} on card ${cardId}`);
  if (!Number.isSafeInteger(index) || index < 0 || index >= located.block.items.length) {
    throw new Error(`unknown follow-up ${index} on block ${blockId}`);
  }
  const item = located.block.items[index];
  const message = item.ask ?? item.label;
  const quote = item.label;
  // Qualified like every other block anchor (#116): a bare block ID would
  // match the same-numbered block of every card at render time.
  const anchor = {
    host: { kind: "block" as const, blockId: `${cardId}#${located.block.id}` },
    quotedText: quote,
    prefix: "",
    suffix: "",
    position: 0,
    version: snapshot.version.n,
  };

  const key = {
    anchor: `followup:${cardId}:${blockId}:${index}`,
    requestKind: "followup",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) {
    const existing = snapshot.annotations.find((a) => a.jobId === active.id);
    return { annotationId: existing?.id ?? "", jobId: active.id, deduplicated: true };
  }

  // Consume the suggestion + create the answer expansion (working state).
  const annotationId = newAnnotationId();
  await reviews.mutate(reviewId, (draft) => {
    removeFollowUpItem(draft, cardId, blockId, index);
    draft.annotations.push({
      id: annotationId,
      type: "expansion",
      anchor: { ...anchor },
      open: true,
      messages: [],
      post: false,
      note: false,
      working: "Writing answer…",
      expansion: {
        blocks: [],
        level: "standard",
        read: false,
        collapsed: false,
        revision: 1,
        undoStack: [],
        working: "Writing answer…",
      },
    } as unknown as Annotation);
  });

  const live = getSnapshotOrThrow(reviews, reviewId);
  const ann = live.annotations.find((a) => a.id === annotationId)!;
  const variables = await l4VariablesWithRevealed(ctx, live, ann.anchor, { message });
  const capture = captureJobId();
  const done = pipeline.runInFork({
    reviewId,
    kind: "ask",
    template: "ask",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    threadId: annotationId,
    conversationKey: annotationId,
    // Issue #50: the expansion header shows the suggestion label; the
    // question is the label (or its pre-baked ask text).
    echoCandidates: [quote, message],
    replay: isReplayRunner(pipeline.runner) ? { kind: "ask" } : undefined,
    onJob: (job: Job) => {
      capture.onJob(job);
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          if (found) {
            found.jobId = job.id;
            if (found.type === "expansion" && found.expansion) found.expansion.jobId = job.id;
          }
        })
        .catch(() => {});
    },
    onPartial: (cards) => {
      const blocks = dedupeBlockIds(cards.flatMap((c) => c.blocks));
      if (blocks.length === 0) return;
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          if (found?.type === "expansion" && found.expansion && !found.error) {
            found.expansion.blocks = blocks as Block[];
          }
        })
        .catch(() => {});
    },
  });

  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      capture.settled();
      const canon = aliasCanonicalizer(getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
      const fixed = dedupeBlockIds(
        remapAliasTargets(res.cards.flatMap((c) => c.blocks) as Block[], res.validation.tokens, canon),
      );
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        found.expansion.blocks = fixed;
        found.expansion.revision += 1;
        found.working = null;
        found.expansion.working = null;
        found.error = null;
        found.expansion.error = null;
        found.jobId = undefined;
        found.expansion.jobId = undefined;
      });
      // Follow-up answers are new expansion content: log in full.
      try {
        const jobId = (await capture.wait())?.id;
        const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        const live = getSnapshotOrThrow(reviews, reviewId);
        const filled = live.annotations.find((a) => a.id === annotationId);
        const event = filled ? newCardForExpansion(reviewId, live, filled, sessionId) : null;
        if (event) await recordInteraction(event);
      } catch {
        // Logging never fails the action.
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      const msg = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        found.working = null;
        found.expansion.working = null;
        found.error = msg;
        found.expansion.error = msg;
      });
      return msg;
    },
  );

  const job = await capture.wait();
  if (job) {
    handled.catch(() => {});
    return { annotationId, jobId: job.id };
  }
  // No job: the fill settled inline (fail-fast agent). Its error, if any,
  // is already on the expansion's visible error state.
  await handled;
  return { annotationId };
}

function findFollowUp(
  snapshot: ReturnType<typeof getSnapshotOrThrow>,
  cardId: string,
  blockId: string,
): { block: FollowUpBlock } | null {
  const fromBlocks = (blocks: Block[]): FollowUpBlock | null => {
    for (const b of blocks) {
      if (b.type === "follow-up" && (b.id === blockId || b.id === shortId(blockId))) {
        return b as FollowUpBlock;
      }
    }
    return null;
  };
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id !== cardId) continue;
      const hit = fromBlocks(card.blocks);
      if (hit) return { block: hit };
    }
  }
  const ann = (snapshot.annotations ?? []).find((a) => a.id === cardId);
  if (ann?.type === "expansion" && ann.expansion) {
    const hit = fromBlocks(ann.expansion.blocks);
    if (hit) return { block: hit };
  }
  // The block may live on a different card than addressed (anchor drift):
  // search everywhere as a fallback.
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      const hit = fromBlocks(card.blocks);
      if (hit) return { block: hit };
    }
  }
  return null;
}

function shortId(raw: string): string {
  if (raw.includes("#")) return raw.split("#").pop()!;
  if (raw.includes(":")) return raw.split(":").pop()!;
  return raw;
}

function removeFollowUpItem(
  draft: WritableDraft<ReviewSnapshot>,
  cardId: string,
  blockId: string,
  index: number,
): void {
  const removeFrom = (blocks: Block[]): boolean => {
    for (const b of blocks) {
      if (b.type === "follow-up" && (b.id === blockId || shortId(b.id) === shortId(blockId))) {
        (b as FollowUpBlock).items.splice(index, 1);
        return true;
      }
    }
    return false;
  };
  for (const page of draft.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id === cardId && removeFrom(card.blocks as Block[])) return;
    }
  }
  const ann = (draft.annotations as unknown as Annotation[]).find((a) => a.id === cardId);
  if (ann?.type === "expansion" && ann.expansion) removeFrom(ann.expansion.blocks);
}
