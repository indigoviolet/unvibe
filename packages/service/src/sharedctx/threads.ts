/**
 * Thread settling (PRD §9.3: "one line, once a thread settles").
 *
 * A thread settles when:
 * - it is closed (`open === false`), or
 * - it has been idle for `settleAfterMs` after the last agent reply.
 *
 * "Idle" is measured against the thread's own activity, not wall-clock
 * polling: callers pass `now` (epoch ms, fake-clock friendly) and the thread
 * snapshot. The summary is written by the small model through `runSmall`
 * (injected as `summarizeWithSmallModel` so this module stays pure of the
 * pipeline); when no small model is available the fallback is the first line
 * of the last agent reply.
 */
import type { Annotation } from "@unvibe/shared";

/** Default idle time after an agent reply before a thread counts as settled. */
export const DEFAULT_THREAD_SETTLE_MS = 5 * 60 * 1000;

export interface ThreadSnapshot {
  id: string;
  open: boolean;
  messages: { who: "you" | "ai"; text?: string; html?: string }[];
  /** Epoch ms of the last message; null when unknown (never settles by idle). */
  lastActivityAt: number | null;
}

export function toThreadSnapshot(thread: Annotation, lastActivityAt: number | null): ThreadSnapshot {
  return {
    id: thread.id,
    open: thread.open,
    messages: thread.messages.map((m) => ({ who: m.who, ...(m.text !== undefined ? { text: m.text } : {}), ...(m.html !== undefined ? { html: m.html } : {}) })),
    lastActivityAt,
  };
}

/** True once the thread has settled (closed, or idle past the threshold). */
export function isThreadSettled(
  thread: ThreadSnapshot,
  now: number,
  settleAfterMs: number = DEFAULT_THREAD_SETTLE_MS,
): boolean {
  if (!thread.open) return true;
  // Only an agent reply can settle an open thread: a thread waiting on the
  // agent (last message is the reader's) is still live.
  const last = thread.messages[thread.messages.length - 1];
  if (!last || last.who !== "ai") return false;
  if (thread.lastActivityAt === null) return false;
  return now - thread.lastActivityAt >= settleAfterMs;
}

/** Plain text of the last agent message (HTML stripped to words). */
export function lastAgentText(thread: ThreadSnapshot): string {
  return lastAgentLines(thread).join("\n");
}

/** The last agent message as lines (tags stripped, whitespace folded per line). */
export function lastAgentLines(thread: ThreadSnapshot): string[] {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.who !== "ai") continue;
    const raw = m.text ?? m.html ?? "";
    const stripped = raw.replace(/<[^>]+>/g, "");
    return stripped
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l !== "");
  }
  return [];
}

/** Fallback summary: the first line of the last agent reply. */
export function fallbackThreadSummary(thread: ThreadSnapshot): string {
  const first = lastAgentLines(thread)[0] ?? "";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

/**
 * Summarize a settled thread: the small model when available, else the
 * first line of the last agent reply. `summarizeWithSmallModel` receives
 * the rendered thread and returns one line; a rejection falls back too.
 */
export async function summarizeSettledThread(
  thread: ThreadSnapshot,
  summarizeWithSmallModel?: (threadText: string) => Promise<string>,
): Promise<string> {
  const rendered = thread.messages
    .map((m) => `${m.who === "ai" ? "Agent" : "Reader"}: ${(m.text ?? m.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`)
    .join("\n");
  if (summarizeWithSmallModel) {
    try {
      const summary = (await summarizeWithSmallModel(rendered)).split("\n")[0].trim();
      if (summary) return summary.length > 160 ? `${summary.slice(0, 159)}…` : summary;
    } catch {
      // fall through to the first-line fallback
    }
  }
  return fallbackThreadSummary(thread);
}
