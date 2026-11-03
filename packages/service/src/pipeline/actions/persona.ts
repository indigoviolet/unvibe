/**
 * Persona card runs (issue #349, step 2).
 *
 * Choosing a persona in the card toolbar runs it on that card: base L0 +
 * the persona lens + the `persona_card` task + the persona's card
 * instruction, on the persona's provider/model. It forks that provider's
 * base session (or the fresh-session fallback, through the normal path —
 * `runInFork` with `persona`).
 *
 * The output is a normal card — same blocks, citations, validation and
 * the single repair turn — stored as a variant keyed by persona on that
 * card. A stored-shape change needs no DATA_FORMAT bump (step 1 already
 * went to 2): `variants` is a new optional map, absent on older stored
 * cards, and nothing stored before is re-read.
 */
import type { Anchor, Block, CardVariant, Job, Persona, ReviewSnapshot } from "@unvibe/shared";
import { blockPlainText, dedupeBlockIds, isCardVariant, JOB_PRIORITY } from "@unvibe/shared";
import { cardPromptText, recordInteraction } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { DEFAULT_CARD_INSTRUCTION } from "../../prompts/personas.js";
import {
  baseVersionOf,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  type ActionContext,
} from "./common.js";
import { cardTitle, storedCardTitle } from "./events.js";
import { aliasCanonicalizer, remapAliasTargets } from "./validate-apply.js";
import { finalizeFresh, repairDiagrams } from "./diagram-finalize.js";

/** Working line while a persona variant fills. */
export const PERSONA_WORKING = "Persona is writing";

/**
 * Resolve a persona definition from settings. Throws when unknown; a
 * disabled persona cannot run (the toolbar only lists enabled ones, so
 * this is a stale-request guard, not a UI path).
 */
export function personaFor(ctx: ActionContext, personaId: string): Persona {
  if (!ctx.settings) throw new Error("personas are not available in this build");
  const personas = ctx.settings.get().personas ?? [];
  const persona = personas.find((p) => p.id === personaId);
  if (!persona) throw new Error(`unknown persona ${personaId}`);
  if (!persona.enabled) throw new Error(`persona "${persona.name}" is disabled`);
  if (persona.lens.trim() === "") throw new Error("persona lens must be a non-empty string");
  return persona;
}

/**
 * Plain text of one variant block (for the Ask/Explain prompt's anchor
 * block on a persona's version). Null when the block is not in the
 * variant — the caller keeps the guide text then.
 */
export function personaVariantBlockText(
  snapshot: ReviewSnapshot,
  cardId: string,
  personaId: string,
  anchor: Anchor,
): string | null {
  if (anchor.host.kind !== "block") return null;
  const variant = variantFor(snapshot, cardId, personaId);
  if (!variant) return null;
  const raw = anchor.host.blockId;
  const short = raw.includes("#") ? raw.split("#").pop()! : raw.includes(":") ? raw.split(":").pop()! : raw;
  const find = (blocks: Block[]): Block | null => {
    for (const b of blocks) {
      if (b.id === raw || b.id === short) return b;
      if (b.type === "aside") {
        const hit = find(b.inner);
        if (hit) return hit;
      }
    }
    return null;
  };
  const hit = find(variant.blocks);
  return hit ? blockPlainText(hit) : null;
}

/**
 * Guide card id for a thread anchor opened on a persona's version.
 * Persona conversations anchor on card text, so only block anchors
 * resolve (the host `card#block` names the guide card); every other
 * anchor kind cannot carry a persona version.
 */
export function personaCardForAnchor(snapshot: ReviewSnapshot, anchor: Anchor): string | null {
  if (anchor.host.kind !== "block") return null;
  const raw: string = anchor.host.blockId;
  const cardPart = raw.includes("#") ? raw.split("#")[0] : null;
  if (cardPart) {
    const exists = (snapshot.pages ?? []).some((p) => (p.cards ?? []).some((c) => c.id === cardPart));
    return exists ? cardPart : null;
  }
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      const hit =
        (card.blocks ?? []).some((b) => b.id === raw) ||
        Object.values(card.variants ?? {}).some(
          (v) => isCardVariant(v) && (v.blocks ?? []).some((b) => b.id === raw),
        );
      if (hit) return card.id;
    }
  }
  return null;
}

/** The guide card's persona variant, or null when it never ran. */
export function variantFor(snapshot: ReviewSnapshot, cardId: string, personaId: string): CardVariant | null {
  for (const page of snapshot.pages ?? []) {
    const card = (page.cards ?? []).find((c) => c.id === cardId);
    if (card) {
      const v = card.variants?.[personaId];
      return v && isCardVariant(v) ? v : null;
    }
  }
  return null;
}

/**
 * Render the guide card's persona variant for a prompt (the variant's
 * own blocks, like `cardPromptText` renders the guide version).
 */
export function personaVariantPromptText(snapshot: ReviewSnapshot, cardId: string, personaId: string): string {
  const variant = variantFor(snapshot, cardId, personaId);
  if (!variant) throw new Error(`persona ${personaId} has not run on card ${cardId} yet`);
  for (const page of snapshot.pages ?? []) {
    const card = (page.cards ?? []).find((c) => c.id === cardId);
    if (!card) continue;
    const head = card.title ?? "(untitled)";
    const body = variant.blocks.map((b) => blockPlainText(b)).join("\n\n");
    return `### ${head} [[card:${card.id}]] (level: ${variant.level}, revision ${variant.revision})\n\n${body}`;
  }
  throw new Error(`unknown card ${cardId}`);
}

/**
 * Run a persona on a page card and store the result as a variant keyed
 * by persona. The citation repair turn happens inside `runInFork`
 * (same as cards); inline diagrams go through the same finalize + one
 * repair turn as every other fill. A still-invalid result after repair
 * is a visible error on the variant (banner + Retry), never a silent
 * store.
 */
export async function personaAction(
  ctx: ActionContext,
  cardId: string,
  personaId: string,
): Promise<{ cardId: string; personaId: string; jobId?: string; deduplicated?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const persona = personaFor(ctx, personaId);
  const page = (snapshot.pages ?? []).find((p) => (p.cards ?? []).some((c) => c.id === cardId));
  const card = page?.cards.find((c) => c.id === cardId);
  if (!card || card.pending) throw new Error(`unknown card ${cardId}`);

  const key = {
    anchor: `persona:${cardId}:${personaId}`,
    requestKind: "persona",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, personaId, jobId: active.id, deduplicated: true };

  const cardInstruction =
    persona.cardInstruction.trim() !== "" ? persona.cardInstruction : DEFAULT_CARD_INSTRUCTION;
  const variables = { card: cardPromptText(snapshot, cardId), card_instruction: cardInstruction };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner)
    ? { kind: "persona", key: `${cardId}:${personaId}` }
    : undefined;
  const echoTitle = storedCardTitle(snapshot, cardId);

  // Immediately visible working state on the variant (the tab exists
  // before the job settles, so the run is never a silent spinner).
  await reviews.mutate(reviewId, (draft) => {
    const target = (draft.pages ?? [])
      .flatMap((p) => p.cards ?? [])
      .find((c) => c.id === cardId);
    if (!target) return;
    if (!target.variants) target.variants = {};
    const prev = target.variants[personaId];
    target.variants[personaId] = {
      personaId,
      blocks: prev && isCardVariant(prev) ? prev.blocks : [],
      level: (prev && isCardVariant(prev) ? prev.level : card.level) ?? "standard",
      revision: (prev && isCardVariant(prev) ? prev.revision : 0) ?? 0,
      undoStack: (prev && isCardVariant(prev) ? prev.undoStack : []) ?? [],
      ...(prev && isCardVariant(prev) && prev.sessionId ? { sessionId: prev.sessionId } : {}),
      working: PERSONA_WORKING,
      error: null,
    };
  });

  const done = pipeline.runInFork({
    reviewId,
    kind: "persona",
    template: "persona_card",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    cardId,
    persona,
    // The variant's own session for this card: later turns on the
    // variant continue it instead of forking again.
    conversationKey: `persona:${cardId}:${personaId}`,
    ...(echoTitle ? { echoCandidates: [echoTitle] } : {}),
    ...(replay ? { replay } : {}),
    onJob: (job: Job) => {
      capture.onJob(job);
      void reviews
        .mutate(reviewId, (draft) => {
          const target = (draft.pages ?? [])
            .flatMap((p) => p.cards ?? [])
            .find((c) => c.id === cardId);
          const variant = target?.variants?.[personaId];
          if (variant) variant.jobId = job.id;
        })
        .catch(() => {});
    },
  });

  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      capture.settled();
      const jobId = (await capture.wait())?.id;
      const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
      const raw = dedupeBlockIds(res.cards.flatMap((c) => c.blocks)) as Block[];
      const canon = aliasCanonicalizer(getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
      const fixed = remapAliasTargets(raw, res.validation.tokens, canon);
      let stored: Block[];
      {
        const first = await finalizeFresh(ctx, fixed);
        if (first.needsRepair) {
          try {
            const repaired = await repairDiagrams(
              ctx,
              {
                card: cardPromptText(getSnapshotOrThrow(reviews, reviewId), cardId),
                level: card.level,
                dedupeAnchor: `persona:${cardId}:${personaId}`,
                requestKind: "persona-diagram-repair",
                cardId,
                conversationKey: `persona:${cardId}:${personaId}`,
                persona,
              },
              first.blocks,
              first.messages,
            );
            stored = (await finalizeFresh(ctx, repaired)).blocks;
          } catch {
            stored = first.blocks;
          }
        } else {
          stored = first.blocks;
        }
      }
      // A result with nothing usable after the repair turn is a visible
      // error (banner + Retry), never a silent store: keep the previous
      // variant content and surface the failure on the variant. Usable
      // content with unverified citations stores with the normal
      // unverified marks (red text, not a banner) — `remapAliasTargets`
      // above already flagged them, like every other fill.
      if (stored.length === 0) {
        const reasons = res.validation.tokens
          .filter((t) => t.status === "unverified")
          .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
          .join("\n");
        await reviews.mutate(reviewId, (draft) => {
          const target = (draft.pages ?? [])
            .flatMap((p) => p.cards ?? [])
            .find((c) => c.id === cardId);
          const variant = target?.variants?.[personaId];
          if (!target || !variant) return;
          variant.working = null;
          variant.jobId = undefined;
          variant.error =
            reasons.trim() !== ""
              ? `The persona's version still has unverified citations:\n${reasons}`
              : "The persona's version came back empty.";
        });
        return null;
      }
      await reviews.mutate(reviewId, (draft) => {
        const target = (draft.pages ?? [])
          .flatMap((p) => p.cards ?? [])
          .find((c) => c.id === cardId);
        if (!target?.variants?.[personaId]) return;
        const prev = target.variants[personaId];
        const prevBlocks = prev && isCardVariant(prev) ? prev.blocks : [];
        const prevLevel = prev && isCardVariant(prev) ? prev.level : card.level;
        const prevStack = prev && isCardVariant(prev) ? prev.undoStack : [];
        target.variants[personaId] = {
          personaId,
          blocks: stored,
          level: prevLevel ?? "standard",
          revision: (prev && isCardVariant(prev) ? prev.revision : 0) + 1,
          undoStack:
            prevBlocks.length > 0
              ? [...prevStack, { blocks: prevBlocks, level: prevLevel ?? "standard" }]
              : prevStack,
          ...(sessionId ? { sessionId } : prev && isCardVariant(prev) && prev.sessionId ? { sessionId: prev.sessionId } : {}),
          working: null,
          error: null,
        };
      });
      try {
        const live = getSnapshotOrThrow(reviews, reviewId);
        await recordInteraction({
          kind: "new-card",
          reviewId,
          cardId,
          text: `Persona "${persona.name}" wrote its version of "${cardTitle(live, cardId)}"`,
        });
      } catch {
        // Logging never fails the action.
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      const message = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const target = (draft.pages ?? [])
          .flatMap((p) => p.cards ?? [])
          .find((c) => c.id === cardId);
        const variant = target?.variants?.[personaId];
        if (!target || !variant) return;
        variant.working = null;
        variant.jobId = undefined;
        variant.error = message;
      });
      return message;
    },
  );

  const job = await capture.wait();
  if (job) {
    handled.catch(() => {});
    return { cardId, personaId, jobId: job.id };
  }
  const fillError = await handled;
  if (fillError) throw new Error(fillError);
  return { cardId, personaId };
}
