/**
 * Thread helpers (comments owner).
 *
 * - `threadPostText`: exact text posted for a thread (Outbox draft, else
 *   first user message, else suggested message) — mirrors the service's
 *   `threadPostText` so the Comments menu and Submit panel show what will
 *   be posted without importing service code.
 * - `pendingThreads` / `outboxThreads` / `pendingCount`: Submit counts
 *   (posted threads are never pending).
 * - `threadLocationLabel`: short human location for menus (`file:line`,
 *   guide excerpt, or "General PR comment").
 */
import type { Thread, ReviewSnapshot } from "@unvibe/shared";
import { descriptionPaneName } from "../source/description/paneName.js";

function replyText(reply: { blocks?: Array<{ type: string }> }): string {
  const parts: string[] = [];
  for (const b of ((reply.blocks ?? []) as Array<Record<string, unknown>>)) {
    if (b["type"] === "paragraph") {
      const t = b["text"] as Record<string, unknown> | undefined;
      const s = typeof t?.["standard"] === "string" ? (t["standard"] as string) : "";
      const plain = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (plain) parts.push(plain);
    }
  }
  return parts.join("\n\n");
}

export function threadPostText(thread: Thread): string {
  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const comments = (thread.replies ?? []).filter((r) => r.kind === "comment");
  const you = comments.find((r) => r.who === "you" && replyText(r) !== "");
  if (you) return replyText(you);
  const suggested = comments.find((r) => r.suggested && replyText(r) !== "");
  if (suggested) return replyText(suggested);
  const first = comments.find((r) => replyText(r) !== "");
  return first ? replyText(first) : "";
}

/** Threads already posted to GitHub (skipped on retry, never pending). */
export function isPosted(thread: Thread): boolean {
  return thread.postedAt !== undefined;
}

/** Comment threads in the Outbox that are not yet posted. */
export function outboxThreads(snapshot: ReviewSnapshot | null): Thread[] {
  if (!snapshot) return [];
  return (snapshot.annotations ?? []).filter(
    (a) => a.replies.some((r) => r.kind === "comment") && a.post && !isPosted(a as Thread),
  ) as Thread[];
}

/** Submit count: Outbox threads + pending description edit. */
export function pendingCount(snapshot: ReviewSnapshot | null): number {
  if (!snapshot) return 0;
  const comments = outboxThreads(snapshot).length;
  const desc = snapshot.description?.pendingHtml !== undefined ? 1 : 0;
  return comments + desc;
}

/** All threads with comment replies that carry text (the Comments menu lists these). */
export function listedThreads(snapshot: ReviewSnapshot | null): Thread[] {
  if (!snapshot) return [];
  return (snapshot.annotations ?? []).filter((a) =>
    (a.replies ?? []).some((r) => r.kind === "comment" && replyText(r) !== ""),
  ) as Thread[];
}

/**
 * Short location for a thread: diff threads show `path:line`, guide
 * threads the quoted text (or block), description threads the paragraph.
 * Callers that need the exact GitHub location use the Submit preview.
 */
export function threadLocationLabel(
  snapshot: ReviewSnapshot | null,
  thread: Thread,
): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot?.files.find((f) => f.fileKey === host.fileKey);
    const name = file?.path.split("/").pop() ?? host.fileKey;
    return `${name}:${host.line}`;
  }
  if (host.kind === "description") return descriptionPaneName(snapshot);
  const quote = thread.anchor.quotedText;
  if (quote) return `“${quote.length > 42 ? `${quote.slice(0, 41)}…` : quote}”`;
  return "Guide comment";
}

/** Where a thread lives, for the Comments menu "from …" disambiguation. */
export function threadWhereLabel(
  snapshot: ReviewSnapshot | null,
  thread: Thread,
): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot?.files.find((f) => f.fileKey === host.fileKey);
    return file?.path ?? host.fileKey;
  }
  if (host.kind === "description") return descriptionPaneName(snapshot);
  return "Guide";
}
