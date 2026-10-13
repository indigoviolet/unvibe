/**
 * Thread helpers (comments owner).
 *
 * - `threadPostText`: exact text posted for a thread (For-PR draft, else
 *   first user message, else suggested message) — mirrors the service's
 *   `threadPostText` so the Comments menu and Submit panel show what will
 *   be posted without importing service code.
 * - `pendingThreads` / `forPrThreads` / `pendingCount`: Submit counts
 *   (posted threads are never pending).
 * - `threadLocationLabel`: short human location for menus (`file:line`,
 *   guide excerpt, or "General PR comment").
 */
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { descriptionPaneName } from "../source/description/paneName.js";

export function threadPostText(thread: Annotation): string {
  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const you = thread.messages.find((m) => m.who === "you" && m.text);
  if (you?.text) return you.text;
  const suggested = thread.messages.find((m) => m.suggested && m.text);
  if (suggested?.text) return suggested.text;
  return thread.messages.find((m) => m.text)?.text ?? "";
}

/** Threads already posted to GitHub (skipped on retry, never pending). */
export function isPosted(thread: Annotation): boolean {
  return thread.postedAt !== undefined;
}

/** Comment threads marked For PR that are not yet posted. */
export function forPrThreads(snapshot: ReviewSnapshot | null): Annotation[] {
  if (!snapshot) return [];
  return (snapshot.annotations ?? []).filter(
    (a) => a.type === "comment" && a.post && !isPosted(a as Annotation),
  ) as Annotation[];
}

/** Submit count: For-PR threads + pending description edit. */
export function pendingCount(snapshot: ReviewSnapshot | null): number {
  if (!snapshot) return 0;
  const comments = forPrThreads(snapshot).length;
  const desc = snapshot.description?.pendingHtml !== undefined ? 1 : 0;
  return comments + desc;
}

/** All comments with at least one message (the Comments menu lists these). */
export function listedThreads(snapshot: ReviewSnapshot | null): Annotation[] {
  if (!snapshot) return [];
  return (snapshot.annotations ?? []).filter(
    (a) => a.type === "comment" && (a as Annotation).messages.length > 0,
  ) as Annotation[];
}

/**
 * Short location for a thread: diff threads show `path:line`, guide
 * threads the quoted text (or block), description threads the paragraph.
 * Callers that need the exact GitHub location use the Submit preview.
 */
export function threadLocationLabel(
  snapshot: ReviewSnapshot | null,
  thread: Annotation,
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
  thread: Annotation,
): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = snapshot?.files.find((f) => f.fileKey === host.fileKey);
    return file?.path ?? host.fileKey;
  }
  if (host.kind === "description") return descriptionPaneName(snapshot);
  return "Guide";
}
