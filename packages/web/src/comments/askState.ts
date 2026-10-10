/**
 * Ask working state (comments owner).
 *
 * The agent's reply arrives through a patch via the pipeline seam — which
 * the interaction agent hasn't built yet, so `ask`/`explain` actions still
 * answer 501. The thread must never spin forever: the spinner shows while
 * the reply is plausibly in flight, then yields to a muted waiting note.
 * (Mock mode always answers within a second, so tests never see the
 * fallback.)
 */
import { useEffect, useState } from "react";

/** How long the working spinner shows after the user's last send. */
export const ASK_WORKING_MS = 60_000;

const lastSend = new Map<string, number>();

/** Record a user send on a non-note thread (create or reply). */
export function markAskSent(threadId: string, at = Date.now()): void {
  lastSend.set(threadId, at);
}

/** Test-only: clear send timestamps. */
export function resetAskState(): void {
  lastSend.clear();
}

/** Should the thread show the working spinner right now? */
export function isAskWorking(threadId: string, at = Date.now()): boolean {
  const sent = lastSend.get(threadId);
  if (sent === undefined) return false;
  return at - sent < ASK_WORKING_MS;
}

/** Re-render when the working window for this thread expires. */
export function useAskWorkingTick(threadId: string, active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const sent = lastSend.get(threadId) ?? Date.now();
    const remaining = Math.max(0, ASK_WORKING_MS - (Date.now() - sent));
    const timer = window.setTimeout(() => setTick((t) => t + 1), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [threadId, active]);
}
