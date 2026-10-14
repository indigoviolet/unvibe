/**
 * Shared-context wiring for the pipeline (PRD §9.3–§9.5).
 *
 * Kept in this module (not in `runner.ts`) so the 66 KB runner stays
 * readable; `runner.ts` calls these at three points:
 *
 * 1. before rendering an L4 template: `changeListVariable` injects the
 *    filtered change list (`{{change_list}}`) for the conversation's next
 *    turn — global entries plus local ones for its card or hunk;
 * 2. after a turn succeeds: `ingestAgentTurn` validates the trailing
 *    `contribute` block (citations, dedupe, replaces, ≤3 items), stores the
 *    survivors in the snapshot, appends them to the log labelled with their
 *    source session/thread, advances the seen marker, and grows the base;
 * 3. after the base is (re)built: `noteBaseBuilt` records its size.
 *
 * Failed turns never advance the marker and never store contributions: the
 * next turn retries the same change list. Small-model jobs (`runSmall`) and
 * second-opinion contexts are built by the caller from narrow inputs only —
 * the log, contributions and uncited pins have no channel into them
 * (PRD §12; see `sharedctx/isolation.ts`).
 */
import type { LogEntry, ReplyData, ReviewSnapshot } from "@unvibe/shared";
import { renderMarkdown } from "@unvibe/shared";
import { filterChangeList, formatChangeList } from "../context/log.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SettingsStore } from "../settings/index.js";
import type { ReviewStore } from "../state/store.js";
import type { ReviewLookup } from "../validate/lookup.js";
import { loadTemplatesDirSync } from "../prompts/index.js";
import { processContribute } from "../sharedctx/contributions.js";
import type { SharedContextService } from "../sharedctx/service.js";

export interface TurnWireDeps {
  reviews: ReviewStore;
  sessions: SessionManager;
  settings: SettingsStore;
  sharedctx?: SharedContextService;
  promptsDir: string;
}

/** True when the template declares a `change_list` variable. */
export function templateExpectsChangeList(promptsDir: string, template: string): boolean {
  try {
    const tpl = loadTemplatesDirSync(promptsDir).get(template);
    return tpl?.variables.includes("change_list") ?? false;
  } catch {
    return false;
  }
}

/**
 * Inject the filtered change list into L4 variables when the template wants
 * one and the caller did not supply it.
 *
 * `baseLogSeq` is the log seq already inside the base the fork comes from
 * (the pipeline reads it from the live base it just ensured): entries at or
 * below it are the fork's cached prefix and never repeat. Persistent
 * conversations resume from their cursor via `conversationKey` (seeded at
 * `baseLogSeq` on first use).
 */
export function changeListVariable(
  deps: TurnWireDeps,
  reviewId: string,
  template: string,
  variables: Record<string, unknown>,
  opts: { conversationKey?: string; cardId?: string; hunkHash?: string; baseLogSeq?: number } = {},
): Record<string, unknown> {
  if (variables["change_list"] !== undefined) return variables;
  if (!templateExpectsChangeList(deps.promptsDir, template)) return variables;
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot || !deps.sharedctx) {
    return { ...variables, change_list: "(no changes)" };
  }
  const { text } = deps.sharedctx.changeListFor(reviewId, {
    ...(opts.conversationKey ? { conversationKey: opts.conversationKey } : {}),
    ...(opts.cardId ? { cardId: opts.cardId } : {}),
    ...(opts.hunkHash ? { hunkHash: opts.hunkHash } : {}),
    baseLogSeq: opts.baseLogSeq ?? 0,
  });
  return { ...variables, change_list: text };
}

export interface IngestTurnOptions {
  sessionId: string;
  annotationId?: string;
  conversationKey?: string;
  cardId?: string;
  hunkHash?: string;
  data: ReplyData | null;
  snapshot: ReviewSnapshot;
  lookup: ReviewLookup;
  appendToBase: (baseKey: string, batch: { seq: number; text: string }) => Promise<void>;
}

export interface IngestTurnResult {
  contributionsKept: number;
  contributionsDropped: number;
  grownBatches: number;
}

/**
 * Post-success bookkeeping for one agent turn. Only call when the turn
 * succeeded: contributions are validated/stored/logged, the seen marker
 * advances to the new max seq, and ready log batches grow the base.
 */
export async function ingestAgentTurn(
  deps: TurnWireDeps,
  reviewId: string,
  opts: IngestTurnOptions,
): Promise<IngestTurnResult> {
  const out: IngestTurnResult = { contributionsKept: 0, contributionsDropped: 0, grownBatches: 0 };
  if (!deps.sharedctx) return out;

  if (opts.data?.contribute) {
    const existing = opts.snapshot.contributions;
    const nextId = nextContributionId(existing);
    const contextText = sessionContextText(opts.snapshot);
    const outcome = processContribute(
      {
        reviewId,
        sessionId: opts.sessionId,
        ...(opts.annotationId ? { annotationId: opts.annotationId } : {}),
        contribute: opts.data.contribute,
        contextText,
        existing,
        nextId,
      },
      opts.lookup,
    );
    out.contributionsKept = outcome.kept.length;
    out.contributionsDropped = outcome.dropped.length;
    if (outcome.kept.length > 0 || outcome.supersededIds.length > 0 || outcome.logEntries.length > 0) {
      await deps.reviews.mutate(reviewId, (draft) => {
        for (const c of outcome.kept) draft.contributions.push(c);
        for (const id of outcome.supersededIds) {
          const prev = draft.contributions.find((x) => x.id === id);
          if (prev && prev.status === "pending") prev.status = "merged";
        }
        for (const entry of outcome.logEntries) {
          const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
          draft.logTail.push({ seq, kind: entry.kind, payload: entry.payload, scope: entry.scope });
        }
      });
    }
  }

  deps.sharedctx.noteTurnSuccess(reviewId, {
    ...(opts.conversationKey ? { conversationKey: opts.conversationKey } : {}),
    sessionId: opts.sessionId,
  });

  try {
    const grown = await deps.sharedctx.maybeGrowBase(reviewId, opts.appendToBase);
    out.grownBatches = grown.appended;
  } catch {
    // Growth is best-effort; the log already holds the entries.
  }
  return out;
}

/** Next contribution id: one past the highest `ct_<n>` suffix in use. */
export function nextContributionId(existing: { id: string }[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^ct_(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ct_${max + 1}`;
}

/** Text the session already saw (guide + findings): dedupe surface. */
export function sessionContextText(snapshot: ReviewSnapshot): string {
  const parts: string[] = [];
  for (const page of snapshot.pages) {
    for (const card of page.cards) {
      parts.push(renderMarkdown(card.blocks));
    }
  }
  return parts.join("\n");
}

/** Filtered change-list entries (pure helper for tests of the seam). */
export function changeListEntries(
  log: LogEntry[],
  filter: { lastSeenSeq: number; cardId?: string; hunkHash?: string },
): LogEntry[] {
  return filterChangeList(log, filter);
}

export { formatChangeList };
