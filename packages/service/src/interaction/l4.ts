/**
 * L4 conversation variables (M4, PRD §9.1).
 *
 * Pure builders over a `ReviewSnapshot`: anchor quote, full host block,
 * its card, nearby annotations in full, thread so far, change list, user
 * message. The action modules render these into the `explain` / `ask`
 * templates through `runInFork`.
 */
import type { Annotation, Block, ReviewSnapshot } from "@unvibe/shared";
import { currentDescriptionHtml, descriptionParagraphText } from "../ingest/description.js";

function blockPlainText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return block.text.standard;
    case "list":
      return block.items.map((it) => it.html.replace(/<[^>]+>/g, " ")).join("\n");
    case "table":
      return block.html.replace(/<[^>]+>/g, " ");
    case "code":
      return block.code;
    case "diagram":
      return [block.source, block.caption ?? ""].join("\n");
    case "finding-link":
      return `(finding: ${block.pageId})`;
    case "comment-link":
      return `(comment on ${block.diffRef})`;
    case "follow-up":
      return block.items.map((it) => `- ${it.label}`).join("\n");
    case "aside":
      return `[${block.kind}] ${block.inner.map(blockPlainText).join("\n")}`;
  }
}

/** One-line excerpt of a quote for labels and headings. */
export function excerptQuote(q: string, max = 240): string {
  return q.length > max ? `${q.slice(0, max)}…` : q;
}

/**
 * The quote as inlined in a prompt. Selections can run to 10,000
 * characters; past 2,000 the prompt gets the head and tail plus the
 * selection's size and (for diff lines) its line range — the full
 * selection always travels in the host block below it.
 */
export function quoteForPrompt(anchor: Annotation["anchor"]): string {
  const q = anchor.quotedText ?? "";
  if (q.length <= 2000) return q;
  const host = anchor.host;
  const where =
    host.kind === "diff-line"
      ? `lines ${host.line}–${host.endLine ?? host.line} of ${host.fileKey}`
      : "the host block below";
  return `${q.slice(0, 900)}\n\n[… ${q.length} characters selected (${where}); the full selection is in the host block below …]\n\n${q.slice(-300)}`;
}

function shortBlockId(raw: string): string {
  if (raw.includes("#")) return raw.split("#").pop()!;
  if (raw.includes(":")) return raw.split(":").pop()!;
  return raw;
}

/**
 * Card part of a `<card>#<block>` / `card:<card>#<block>` block id, or
 * null for a bare id.
 */
function cardOfBlockId(raw: string): string | null {
  const hash = raw.lastIndexOf("#");
  if (hash < 0) return null;
  const card = raw.slice(0, hash);
  return card.startsWith("card:") ? card.slice("card:".length) : card;
}

/**
 * Locate a block by id; returns card + block. Block ids restart at `b1`
 * in every card, so a `<card>#<block>` id is looked up in that card (or
 * answer) only. A bare id, or a card that no longer exists, falls back
 * to the first block with that id on any page.
 */
export function findBlock(
  snapshot: ReviewSnapshot,
  blockId: string,
): { cardId: string; pageId: string; cardTitle: string | null; block: Block } | null {
  const cardId = cardOfBlockId(blockId);
  return (cardId !== null ? findBlockIn(snapshot, blockId, cardId) : null) ?? findBlockIn(snapshot, blockId, null);
}

/** Locate one conversation answer by id (page cards are not answers). */
export function findAnswer(
  snapshot: ReviewSnapshot,
  answerId: string,
): { annotation: Annotation; turn: import("@unvibe/shared").Turn } | null {
  for (const annotation of snapshot.annotations ?? []) {
    const turn = (annotation.turns ?? []).find((t) => t.id === answerId);
    if (turn) return { annotation, turn };
  }
  return null;
}

function findBlockIn(
  snapshot: ReviewSnapshot,
  blockId: string,
  onlyCard: string | null,
): { cardId: string; pageId: string; cardTitle: string | null; block: Block } | null {
  const short = shortBlockId(blockId);
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (onlyCard !== null && card.id !== onlyCard) continue;
      for (const block of card.blocks ?? []) {
        if (block.id === blockId || block.id === short) {
          return { cardId: card.id, pageId: page.id, cardTitle: card.title, block };
        }
        if (block.type === "aside") {
          for (const inner of block.inner) {
            if (inner.id === blockId || inner.id === short) {
              return { cardId: card.id, pageId: page.id, cardTitle: card.title, block: inner };
            }
          }
        }
      }
    }
  }
  // Conversation answers hold blocks too (#136): the card part of
  // `<answer>#<block>` is the answer's own `ans_…` id.
  for (const ann of snapshot.annotations ?? []) {
    for (const turn of ann.turns ?? []) {
      if (onlyCard !== null && turn.id !== onlyCard) continue;
      for (const block of turn.blocks) {
        if (block.id === blockId || block.id === short) {
          return { cardId: turn.id, pageId: "", cardTitle: turn.question ?? ann.anchor.quotedText, block };
        }
        // Aside inner blocks, like page cards above (#116: citations and
        // anchors address them the same way in both hosts).
        if (block.type === "aside") {
          for (const inner of block.inner) {
            if (inner.id === blockId || inner.id === short) {
              return { cardId: turn.id, pageId: "", cardTitle: turn.question ?? ann.anchor.quotedText, block: inner };
            }
          }
        }
      }
    }
  }
  return null;
}

/** Comment annotation behind a comment host (issue #214), or null. */
export function findComment(snapshot: ReviewSnapshot, commentId: string): Annotation | null {
  return (snapshot.annotations ?? []).find((a) => a.id === commentId && a.type === "comment") ?? null;
}

/** Plain text of a comment: its messages joined, in order. */
export function commentPlainText(comment: Annotation): string {
  return (comment.messages ?? []).map((m) => m.text ?? "").filter((t) => t !== "").join("\n\n");
}

/**
 * Host text for a comment host: the message containing the quote when one
 * does, else the whole comment text. Null when the comment is unknown.
 */
export function commentHostText(snapshot: ReviewSnapshot, commentId: string, quote?: string): string | null {
  const comment = findComment(snapshot, commentId);
  if (!comment) return null;
  if (quote) {
    const hit = (comment.messages ?? []).find((m) => (m.text ?? "").includes(quote));
    if (hit?.text) return hit.text;
  }
  return commentPlainText(comment);
}

/** Full host block text for an anchor (paragraph / description / diff). */
export function hostBlockText(snapshot: ReviewSnapshot, anchor: Annotation["anchor"]): string {
  const host = anchor.host;
  if (host.kind === "block") {
    const found = findBlock(snapshot, host.blockId);
    if (found) return blockPlainText(found.block);
    return `(unknown block ${host.blockId})`;
  }
  if (host.kind === "description") {
    const text = descriptionParagraphText(currentDescriptionHtml(snapshot.description), host.paragraphId);
    if (text !== null) return text;
    return `(unknown description paragraph ${host.paragraphId})`;
  }
  if (host.kind === "comment") {
    // Issue #214: the host block is the comment's own text.
    return commentHostText(snapshot, host.commentId, anchor.quotedText) ?? "(unknown comment)";
  }
  if (host.kind === "hunk") {
    // Issue #138: a hunk card's text is its summary (the first turn's
    // blocks). Actions run as nested cards on summary blocks, so this is
    // normally unreachable — a backstop, not a context source.
    const card = (snapshot.annotations ?? []).find(
      (a) =>
        a.type === "conversation" &&
        a.anchor.host.kind === "hunk" &&
        a.anchor.host.fileKey === host.fileKey &&
        a.anchor.host.contentHash === host.contentHash,
    );
    const first = card?.turns?.[0];
    if (first) return first.blocks.map((b) => blockPlainText(b)).join("\n\n");
    return `(unknown hunk ${host.fileKey}:${host.contentHash})`;
  }
  const file = (snapshot.files ?? []).find((f) => f.fileKey === host.fileKey);
  if (!file) return `(unknown file ${host.fileKey})`;
  // A multi-line selection's host block is the whole selected range,
  // so a prompt excerpt of the quote still leaves the agent the full
  // text it was asked about.
  const end = host.endLine ?? host.line;
  const rows: string[] = [];
  for (const hunk of file.hunks ?? []) {
    for (const row of hunk.lines) {
      const num = row.newLine ?? row.oldLine;
      if (num === undefined) continue;
      const inRange =
        host.endLine !== undefined
          ? row.newLine !== undefined && row.newLine >= host.line && row.newLine <= end
          : num === host.line;
      if (inRange) rows.push(`${row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}${row.text}`);
    }
  }
  return rows.length > 0 ? rows.join("\n") : `(line ${host.line} not in diff)`;
}

/** The card the anchor belongs to, rendered for the prompt. */
export function cardTextFor(snapshot: ReviewSnapshot, anchor: Annotation["anchor"]): string {
  if (anchor.host.kind === "block") {
    const found = findBlock(snapshot, anchor.host.blockId);
    if (!found) return "(none)";
    // Render the whole host card so the agent sees structure, not just one block.
    for (const page of snapshot.pages ?? []) {
      for (const card of page.cards ?? []) {
        if (card.id === found.cardId) {
          const head = card.title ?? "(untitled)";
          const body = card.blocks.map((b) => blockPlainText(b)).join("\n\n");
          return `### ${head} [[card:${card.id}]]\n\n${body}`;
        }
      }
    }
    // Answers are cards too (#136): render the whole host answer so a
    // nested turn sees structure, not just one block.
    const hostAns = findAnswer(snapshot, found.cardId);
    if (hostAns) {
      const body = hostAns.turn.blocks.map((b) => blockPlainText(b)).join("\n\n");
      return `### ${hostAns.turn.question ?? hostAns.annotation.anchor.quotedText} [[ann:${hostAns.annotation.id}]]\n\n${body}`;
    }
    return blockPlainText(found.block);
  }
  if (anchor.host.kind === "description") {
    return `(PR description paragraph ${anchor.host.paragraphId})`;
  }
  if (anchor.host.kind === "comment") {
    // The comment sits on some other host; show that host's card context
    // (never recursing into another comment host).
    const comment = findComment(snapshot, anchor.host.commentId);
    if (!comment || comment.anchor.host.kind === "comment") return "(none)";
    return cardTextFor(snapshot, comment.anchor);
  }
  const host = anchor.host;
  if (host.kind !== "diff-line") return "(none)";
  const file = (snapshot.files ?? []).find((f) => f.fileKey === host.fileKey);
  return file ? `(diff ${file.path}:${host.line})` : "(none)";
}

/** Nearby annotations on the same host, rendered in full. */
export function nearbyAnnotationsText(
  snapshot: ReviewSnapshot,
  anchor: Annotation["anchor"],
  excludeId?: string,
): string {
  const same = (snapshot.annotations ?? []).filter((a) => {
    if (a.id === excludeId) return false;
    const h = a.anchor.host;
    if (h.kind !== anchor.host.kind) return false;
    if (h.kind === "block" && anchor.host.kind === "block") return shortBlockId(h.blockId) === shortBlockId(anchor.host.blockId);
    if (h.kind === "description" && anchor.host.kind === "description") return h.paragraphId === anchor.host.paragraphId;
    if (h.kind === "diff-line" && anchor.host.kind === "diff-line") {
      return h.fileKey === anchor.host.fileKey && h.line === anchor.host.line;
    }
    if (h.kind === "comment" && anchor.host.kind === "comment") return h.commentId === anchor.host.commentId;
    return false;
  });
  if (same.length === 0) return "(none)";
  return same
    .slice(0, 5)
    .map((a) => {
      if (a.type === "comment") {
        const msgs = a.messages.map((m) => `${m.who === "you" ? "Reader" : "Agent"}: ${m.text ?? ""}`).join("\n");
        return `Comment [[ann:${a.id}]] on "${excerptQuote(a.anchor.quotedText ?? "")}":\n${msgs}`;
      }
      const body = (a.turns ?? [])
        .map((t) => `${t.question === null ? "(the default question)" : `Reader: ${t.question}`}\nAgent: ${t.blocks.map(blockPlainText).join("\n\n")}`)
        .join("\n\n");
      return `Conversation [[ann:${a.id}]] on "${excerptQuote(a.anchor.quotedText ?? "")}":\n${body || "(empty)"}`;
    })
    .join("\n\n");
}

/** Comment messages so far, rendered for the prompt. */
export function threadTextFor(thread: Annotation): string {
  if (thread.messages.length === 0) return "(none)";
  return thread.messages.map((m) => `${m.who === "you" ? "Reader" : "Agent"}: ${m.text ?? ""}`).join("\n\n");
}

/**
 * Issue #136: stored turns so far, rendered for the rebuild prompt.
 * A rebuilt session (restart, idle close) never saw the earlier turns,
 * so the full first-turn prompt carries them as "conversation so far".
 */
export function turnsTextFor(card: Annotation): string {
  if ((card.turns ?? []).length === 0) return "(none)";
  return (card.turns ?? [])
    .map((t) => {
      const q = t.question === null ? "Explain this." : t.question;
      return `Reader: ${q}\nAgent: ${t.blocks.map(blockPlainText).join("\n\n")}`;
    })
    .join("\n\n");
}

/**
 * Full L4 variable set for the explain/ask templates. `anchor.*` is
 * nested (`{{anchor.quote}}` resolves `values.anchor.quote`); the rest
 * are flat names. `change_list` is deliberately absent: the pipeline's
 * shared-context wire injects the filtered change list (global entries
 * plus local ones for the conversation's card/hunk) at render time.
 */
export function l4Variables(
  snapshot: ReviewSnapshot,
  anchor: Annotation["anchor"],
  opts: { thread?: Annotation; message: string; excludeId?: string },
): Record<string, unknown> {
  return {
    anchor: {
      quote: quoteForPrompt(anchor),
      block: hostBlockText(snapshot, anchor),
    },
    card: cardTextFor(snapshot, anchor),
    thread: opts.thread ? threadTextFor(opts.thread) : "(none)",
    message: opts.message,
  };
}

/**
 * Card rendering for the depth/examples/diagram templates. `cardId` is a
 * page-card id or one answer's `ans_…` id; an answer renders with its
 * question in front (per the owner's rule the controls apply to the
 * answer, so the agent rewrites that answer about that question).
 */
export function cardPromptText(snapshot: ReviewSnapshot, cardId: string): string {
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id === cardId) {
        const head = card.title ?? "(untitled)";
        const body = card.blocks
          .map((b) => {
            if (b.type === "paragraph") {
              const parts = [`${blockPlainText(b)}`];
              if (b.text.simple) parts.push(`::: simple\n${b.text.simple}\n:::`);
              if (b.text.deep) parts.push(`::: deep\n${b.text.deep}\n:::`);
              return parts.join("\n\n");
            }
            return blockPlainText(b);
          })
          .join("\n\n");
        return `### ${head} [[card:${card.id}]] (level: ${card.level}, revision ${card.revision})\n\n${body}`;
      }
    }
  }
  const ans = findAnswer(snapshot, cardId);
  if (ans) {
    const body = ans.turn.blocks.map((b) => blockPlainText(b)).join("\n\n");
    const head = ans.turn.question ?? excerptQuote(ans.annotation.anchor.quotedText ?? "");
    return `### ${head} [[ann:${ans.annotation.id}]] (level: ${ans.turn.level}, revision ${ans.turn.revision})\n\n${body}`;
  }
  throw new Error(`unknown card ${cardId}`);
}
