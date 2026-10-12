/**
 * In-flight action helpers (issue #46): one client-side mechanism for the
 * immediate feedback every agent-starting control shows on click.
 *
 * The zustand store (`state/store.ts`) holds the entries; this module maps
 * actions to entry keys, entries/jobs to plain fixed labels (never
 * streamed agent text or progress strings), and decides rewrite (left
 * border, text stays) versus new-content (placeholder) presentation.
 *
 * Agent-starting kinds (verified against
 * `packages/service/src/pipeline/actions/`): explain, ask, reply, retry,
 * depth, examples, diagram, generate, followup, concept, second_opinion,
 * plus the update pass (`POST …/update`). Local-only kinds — read,
 * collapse, bookmark, note, promote, close, delete, undo — need nothing.
 */
import type { ActionAnchor, Job, JobKind } from "@unvibe/shared";
import { isLiveJobState, type InFlightAction, type InFlightKind } from "../state/store.js";

/** Fixed plain label per action (no streamed text, no progress strings). */
export function inflightLabel(kind: InFlightKind): string {
  switch (kind) {
    case "depth":
      return "Rewriting…";
    case "examples":
      return "Adding examples…";
    case "diagram":
      return "Drawing diagram…";
    case "generate":
      return "Writing…";
    case "explain":
      return "Writing explanation…";
    case "ask":
      return "Asking…";
    case "reply":
      return "Writing reply…";
    case "retry":
      return "Retrying…";
    case "followup":
      return "Writing answer…";
    case "second_opinion":
      return "Getting a second opinion…";
    case "concept":
      return "Writing the concept page…";
    case "update":
      return "Updating…";
  }
}

/** Fallback label when only the snapshot job is known (no in-flight entry). */
export function jobLabel(kind: JobKind): string {
  switch (kind) {
    case "depth":
      return inflightLabel("depth");
    case "examples":
      return inflightLabel("examples");
    case "diagram":
      return inflightLabel("diagram");
    case "go-deeper":
      return inflightLabel("generate");
    case "explain":
      return inflightLabel("explain");
    case "ask":
      return inflightLabel("ask");
    case "concept":
      return inflightLabel("concept");
    case "second-opinion":
      return inflightLabel("second_opinion");
    case "update-pass":
      return inflightLabel("update");
    default:
      return "Working…";
  }
}

/**
 * Rewrite of existing content (the card/expansion stays visible under a
 * left border) versus new content (a placeholder appears where it lands):
 * depth changes and examples/diagram inserts rewrite; everything else is
 * new content.
 */
export function isRewriteKind(kind: InFlightKind | JobKind): boolean {
  return kind === "depth" || kind === "examples" || kind === "diagram";
}

/** Live (queued/running/backing-off) job working on a card or thread. */
export function liveJobForTarget(
  jobs: Job[],
  targetId: string,
): Job | undefined {
  return jobs.find(
    (j) =>
      (j.cardId === targetId || j.threadId === targetId) && isLiveJobState(j.state),
  );
}

export interface BusyState {
  kind: InFlightKind | JobKind;
  label: string;
  rewriting: boolean;
}

/** Busy state for a card/expansion: in-flight entry first, live job next. */
export function busyForCard(
  inflight: Record<string, InFlightAction>,
  jobs: Job[],
  cardId: string,
): BusyState | null {
  const entry = inflight[cardId];
  if (entry) {
    return { kind: entry.kind, label: inflightLabel(entry.kind), rewriting: isRewriteKind(entry.kind) };
  }
  const job = liveJobForTarget(jobs, cardId);
  if (job) {
    return { kind: job.kind, label: jobLabel(job.kind), rewriting: isRewriteKind(job.kind) };
  }
  return null;
}

/** In-flight entry for a thread (reply/retry ask turns). */
export function busyForThread(
  inflight: Record<string, InFlightAction>,
  jobs: Job[],
  threadId: string,
): BusyState | null {
  const entry = inflight[threadId];
  if (entry) {
    return { kind: entry.kind, label: inflightLabel(entry.kind), rewriting: false };
  }
  const job = liveJobForTarget(jobs, threadId);
  if (job) {
    return { kind: job.kind, label: jobLabel(job.kind), rewriting: false };
  }
  return null;
}

// --- entry keys -----------------------------------------------------------

/** Stale-card Update / banner Update for a review. */
export function updateKey(reviewId: string): string {
  return `update:${reviewId}`;
}

function anchorSuffix(anchor: ActionAnchor): string {
  if (anchor.where === "block") return `block:${anchor.blockId}`;
  if (anchor.where === "description") return `desc:${anchor.paragraphId}`;
  return `diff:${anchor.fileKey}:${anchor.line}`;
}

/** Explain from a selection: keyed by anchor until the response retargets. */
export function explainKey(anchor: ActionAnchor): string {
  return `explain:${anchorSuffix(anchor)}`;
}

/** Ask from a new-thread composer: keyed by anchor until retargeted. */
export function askKey(anchor: ActionAnchor): string {
  return `ask:${anchorSuffix(anchor)}`;
}

/** Follow-up chip: card + block + item index (prevents double clicks). */
export function followupKey(cardId: string, blockId: string, index: number): string {
  return `followup:${cardId}:${blockId}:${index}`;
}

/** Concept page written on first open. */
export function conceptKey(slug: string): string {
  return `concept:${slug}`;
}

/** In-flight entry addressing an anchor (explain/ask placeholders). */
export function inflightForAnchor(
  inflight: Record<string, InFlightAction>,
  anchor: ActionAnchor,
): InFlightAction | undefined {
  return inflight[explainKey(anchor)] ?? inflight[askKey(anchor)];
}

/**
 * Diff anchor behind an explain entry key (`explain:diff:<fileKey>:<line>`),
 * or null for any other key. The line is the numeric suffix, so file keys
 * containing colons still parse.
 */
export function diffAnchorForExplainKey(key: string): { fileKey: string; line: number } | null {
  if (!key.startsWith("explain:diff:")) return null;
  const rest = key.slice("explain:diff:".length);
  const sep = rest.lastIndexOf(":");
  if (sep < 0) return null;
  const line = Number(rest.slice(sep + 1));
  if (!Number.isSafeInteger(line)) return null;
  return { fileKey: rest.slice(0, sep), line };
}

/**
 * In-flight explain/ask entry for a guide block. Selection anchors use the
 * bare block id while the service may qualify it (`card#block`), so both
 * spellings are checked.
 */
export function inflightForBlock(
  inflight: Record<string, InFlightAction>,
  cardId: string,
  blockId: string,
): InFlightAction | undefined {
  for (const b of [`${cardId}#${blockId}`, blockId]) {
    const anchor: ActionAnchor = { where: "block", blockId: b };
    const found = inflightForAnchor(inflight, anchor);
    if (found) return found;
  }
  return undefined;
}
