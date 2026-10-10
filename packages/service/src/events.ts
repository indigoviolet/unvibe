/** Fan-out of review events to WebSocket subscribers, per review. */
import type { ReviewEvent } from "@unvibe/shared";

export type EventSender = (event: ReviewEvent) => void;

/** Returns an unsubscribe function. */
export type Unsubscribe = () => void;

export class EventBus {
  private subs = new Map<string, Set<EventSender>>();

  subscribe(reviewId: string, send: EventSender): Unsubscribe {
    let set = this.subs.get(reviewId);
    if (!set) {
      set = new Set();
      this.subs.set(reviewId, set);
    }
    set.add(send);
    return () => {
      set.delete(send);
      if (set.size === 0) this.subs.delete(reviewId);
    };
  }

  publish(reviewId: string, event: ReviewEvent): void {
    for (const send of this.subs.get(reviewId) ?? []) {
      try {
        send(event);
      } catch {
        // A failing subscriber must not break fan-out to the rest.
      }
    }
  }

  subscriberCount(reviewId: string): number {
    return this.subs.get(reviewId)?.size ?? 0;
  }
}
