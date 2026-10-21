/**
 * Log taxonomy (PRD §9.3): which interaction events enter the append-only
 * log, with what kind, payload and scope.
 *
 * - never: read, collapse, depth-stepper state, open/close, Outbox marking,
 *   bookmark (and undo — UI state, not shared knowledge);
 * - local to conversations anchored on that card: examples, diagrams, depth
 *   rewrites (card scope required);
 * - one line once a thread settles: `thread-summary`;
 * - in full: new cards and findings, answers that cited something outside
 *   the base;
 * - one-line deletion entry for a deleted item that had been shared.
 */
import type { LogEntry } from "@unvibe/shared";
import { shouldEnterLog } from "../context/log.js";
import type { InteractionEvent } from "./hooks.js";

export interface TaxonomyResult {
  kind: string;
  payload: unknown;
  scope: LogEntry["scope"];
}

/**
 * Map one interaction event to a log entry, or null when it must not enter
 * the log (UI state, or a card-local kind without a card scope).
 */
export function logEntryForEvent(event: InteractionEvent): TaxonomyResult | null {
  switch (event.kind) {
    case "read":
    case "collapse":
    case "depth-state":
    case "open":
    case "close":
    case "mark-for-pr":
    case "bookmark":
    case "undo":
      return null;
    case "example-added":
    case "diagram-added":
    case "depth-rewrite": {
      if (!event.cardId) return null;
      const kind = event.kind === "example-added" ? "example" : event.kind === "diagram-added" ? "diagram" : "depth-rewrite";
      const result: TaxonomyResult = {
        kind,
        payload: { text: event.text, ...(event.sessionId ? { sessionId: event.sessionId } : {}) },
        scope: { scope: "card", cardId: event.cardId },
      };
      if (!shouldEnterLog(kind, result.scope)) return null;
      return result;
    }
    case "thread-settled": {
      const result: TaxonomyResult = {
        kind: "thread-summary",
        payload: {
          summary: event.text,
          annotationId: event.annotationId,
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.hunkHash ? { hunkHash: event.hunkHash } : {}),
        },
        scope: event.cardId ? { scope: "card", cardId: event.cardId } : { scope: "global" },
      };
      // Settled-thread summaries are global knowledge (PRD §9.3: "one line,
      // once a thread settles"): a card scope would hide them from other
      // cards' change lists. Keep the payload's cardId/hunkHash for display.
      const global: TaxonomyResult = { ...result, scope: { scope: "global" } };
      if (!shouldEnterLog("thread-summary", global.scope)) return null;
      return global;
    }
    case "new-card": {
      const result: TaxonomyResult = {
        kind: "new-card",
        payload: { summary: event.text, cardId: event.cardId },
        scope: { scope: "global" },
      };
      if (!shouldEnterLog(result.kind, result.scope)) return null;
      return result;
    }
    case "new-finding": {
      const result: TaxonomyResult = {
        kind: "new-finding",
        payload: { summary: event.text, ...(event.citations ? { citations: event.citations } : {}) },
        scope: { scope: "global" },
      };
      if (!shouldEnterLog(result.kind, result.scope)) return null;
      return result;
    }
    case "out-of-base-answer": {
      const result: TaxonomyResult = {
        kind: "out-of-base-answer",
        payload: {
          summary: event.text,
          ...(event.citations ? { citations: event.citations } : {}),
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        },
        scope: { scope: "global" },
      };
      if (!shouldEnterLog(result.kind, result.scope)) return null;
      return result;
    }
    case "item-deleted": {
      const result: TaxonomyResult = {
        kind: "deletion",
        payload: { summary: event.text },
        scope: { scope: "global" },
      };
      if (!shouldEnterLog(result.kind, result.scope)) return null;
      return result;
    }
  }
}
