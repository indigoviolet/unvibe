/**
 * Milestone spans (issue #356): ingest, refresh, and
 * review-open-to-first-card. Thin wrappers over `traceSpan` so the route
 * call sites stay a few lines each; all attributes are scrubbed by the
 * recorder (review ids hashed, counts numeric).
 */
import type { ReviewEvent } from "@unvibe/shared";
import type { EventBus } from "../events.js";
import type { StatsAttrs } from "./stats-spans.js";
import { traceSpan } from "./tracing.js";

/** Run `fn` under an `ingest` span for the review being created. */
export async function traceIngest<T>(reviewId: string, fn: () => Promise<T>): Promise<T> {
  const span = traceSpan("ingest", { review: reviewId });
  try {
    const out = await fn();
    span.end();
    return out;
  } catch (err) {
    span.end();
    throw err;
  }
}

/**
 * Run `fn` under a `refresh` span for the review being refreshed.
 * `describe` (issue #366) optionally returns the review's stats-shaped
 * attributes once the refresh lands; failures there never fail the span.
 */
export async function traceRefresh<T>(
  reviewId: string,
  fn: () => Promise<T>,
  describe?: () => StatsAttrs | undefined,
): Promise<T> {
  const span = traceSpan("refresh", { review: reviewId });
  try {
    const out = await fn();
    try {
      const extra = describe?.();
      if (extra) for (const [k, v] of Object.entries(extra)) span.setAttribute(k, v);
    } catch {
      // Attribute shaping never breaks the refresh.
    }
    span.end();
    return out;
  } catch (err) {
    span.end();
    throw err;
  }
}

/** True once the snapshot carries any guide card. */
export function hasGuideCards(snapshot: { pages?: { cards?: unknown[] }[] | undefined }): boolean {
  return (snapshot.pages ?? []).some((p) => (p.cards ?? []).length > 0);
}

/** Reviews currently watched (repeated opens/polls share one span). */
const watched = new Set<string>();

/**
 * Start an `open-to-first-card` span when a review without guide cards is
 * opened, and end it on the first guide content (a `patch` adding under
 * `/pages`, or a `snapshot` carrying pages) or on an `error` event.
 * Repeated opens while a watch is pending share the one span. Always
 * unsubscribes; never throws.
 */
export function watchOpenToFirstCard(bus: EventBus, reviewId: string): void {
  if (watched.has(reviewId)) return;
  watched.add(reviewId);
  const span = traceSpan("open-to-first-card", { review: reviewId });
  let done = false;
  let unsub: (() => void) | null = null;
  const finish = (): void => {
    if (done) return;
    done = true;
    watched.delete(reviewId);
    try {
      span.end();
    } finally {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    }
  };
  try {
    unsub = bus.subscribe(reviewId, (event: ReviewEvent) => {
      try {
        if (event.type === "error") {
          finish();
          return;
        }
        if (event.type === "snapshot") {
          if ((event.snapshot.pages ?? []).length > 0) finish();
          return;
        }
        if (event.type === "patch") {
          for (const op of event.ops ?? []) {
            if (op.op === "add" && typeof op.path === "string" && op.path.startsWith("/pages/")) {
              finish();
              return;
            }
          }
        }
      } catch {
        // A malformed event never breaks fan-out or the span.
      }
    });
  } catch {
    finish();
  }
}
