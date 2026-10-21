/**
 * Outbox (#223): the review-kind-agnostic export set and Markdown builder.
 *
 * "Outbox" is the user-facing name for threads whose stored `post` flag is
 * set. The same set is what Submit posts on PR reviews and what the export
 * includes on every review kind (PR, branch, documents #222). Pure logic:
 * no Node or DOM APIs, no agent calls. Documents reuse this module and the
 * `GET /api/reviews/:id/outbox` endpoint unchanged.
 */
import type { Annotation } from "./entities.js";
import type { ReviewSnapshot as Snapshot } from "./api.js";

/** True when a thread is in the Outbox: a marked comment not yet posted. */
export function isInOutbox(thread: Annotation): boolean {
  return thread.type === "comment" && thread.post && !thread.postedAt;
}

/** Every Outbox thread in stored order (export reorders for reading). */
export function outboxThreads(snapshot: Snapshot | null | undefined): Annotation[] {
  if (!snapshot) return [];
  return (snapshot.annotations ?? []).filter((a) => isInOutbox(a as Annotation)) as Annotation[];
}

/** Exact text exported/posted for a thread: draft, else first own, else suggested. */
export function threadOutboxText(thread: Annotation): string {
  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const you = thread.messages.find((m) => m.who === "you" && m.text);
  if (you?.text) return you.text;
  const suggested = thread.messages.find((m) => m.suggested && m.text);
  if (suggested?.text) return suggested.text;
  return thread.messages.find((m) => m.text)?.text ?? "";
}

/** True when any message is an AI-suggested comment (export tags these). */
export function isAiSuggested(thread: Annotation): boolean {
  return thread.messages.some((m) => m.suggested === true);
}

function guideAnchorTitle(snapshot: Snapshot, blockId: string): string {
  const cardId = blockId.includes("#") ? blockId.slice(0, blockId.indexOf("#")) : null;
  const bare = blockId.includes("#") ? blockId.slice(blockId.indexOf("#") + 1) : blockId;
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      const hit =
        (cardId !== null && card.id === cardId) ||
        card.blocks.some((b) => (b as { id?: string }).id === bare || (b as { id?: string }).id === blockId);
      if (!hit) continue;
      if (page.title && card.title) return `${page.title} › ${card.title}`;
      return card.title || page.title || "Guide";
    }
  }
  return "Guide";
}

/** Anchor title for one entry, from what the comment already knows. */
export function outboxAnchorTitle(snapshot: Snapshot, thread: Annotation): string {
  const host = thread.anchor.host;
  if (host.kind === "diff-line") {
    const file = (snapshot.files ?? []).find((f) => f.fileKey === host.fileKey);
    const path = file?.path ?? host.fileKey;
    return host.endLine !== undefined && host.endLine !== host.line
      ? `${path}:${host.line}-${host.endLine}`
      : `${path}:${host.line}`;
  }
  if (host.kind === "description") {
    return snapshot.review.prNumber != null ? "PR description" : "Commits";
  }
  if (host.kind === "block") return guideAnchorTitle(snapshot, host.blockId);
  return "Comment";
}

function hostRank(thread: Annotation): number {
  const kind = thread.anchor.host.kind;
  if (kind === "diff-line") return 0;
  if (kind === "description") return 1;
  if (kind === "block") return 2;
  return 3;
}

function guideOrder(snapshot: Snapshot, thread: Annotation): number {
  if (thread.anchor.host.kind !== "block") return Number.MAX_SAFE_INTEGER;
  const blockId = thread.anchor.host.blockId;
  const bare = blockId.includes("#") ? blockId.slice(blockId.indexOf("#") + 1) : blockId;
  let order = 0;
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.blocks.some((b) => (b as { id?: string }).id === bare)) return order;
      order += 1;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Outbox threads in export order: diff, then description, then guide. */
export function orderedOutboxThreads(snapshot: Snapshot): Annotation[] {
  const fileOrder = new Map((snapshot.files ?? []).map((f, i) => [f.fileKey, i]));
  return outboxThreads(snapshot)
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const rank = hostRank(a.thread) - hostRank(b.thread);
      if (rank !== 0) return rank;
      if (a.thread.anchor.host.kind === "diff-line" && b.thread.anchor.host.kind === "diff-line") {
        const fa = fileOrder.get(a.thread.anchor.host.fileKey) ?? Number.MAX_SAFE_INTEGER;
        const fb = fileOrder.get(b.thread.anchor.host.fileKey) ?? Number.MAX_SAFE_INTEGER;
        if (fa !== fb) return fa - fb;
        if (a.thread.anchor.host.line !== b.thread.anchor.host.line) {
          return a.thread.anchor.host.line - b.thread.anchor.host.line;
        }
      }
      if (a.thread.anchor.host.kind === "block" && b.thread.anchor.host.kind === "block") {
        const ga = guideOrder(snapshot, a.thread) - guideOrder(snapshot, b.thread);
        if (ga !== 0) return ga;
      }
      return a.index - b.index;
    })
    .map(({ thread }) => thread);
}

/**
 * Build the Outbox export Markdown. Heading `# Comments on <title>`; one
 * `## <anchor>` section per entry with the quoted text (when any) and the
 * editable post text. AI-suggested entries carry a `· AI-suggested` tag.
 * An empty Outbox exports just the heading.
 */
export function buildOutboxExportMarkdown(
  snapshot: Snapshot,
  options: { title: string },
): string {
  const lines: string[] = [`# Comments on ${options.title}`, ""];
  for (const thread of orderedOutboxThreads(snapshot)) {
    const tag = isAiSuggested(thread) ? " · AI-suggested" : "";
    lines.push(`## ${outboxAnchorTitle(snapshot, thread)}${tag}`, "");
    const quote = thread.anchor.quotedText?.trim() ?? "";
    if (quote !== "") {
      for (const line of quote.split("\n")) lines.push(`> ${line}`);
      lines.push("");
    }
    lines.push(threadOutboxText(thread), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
