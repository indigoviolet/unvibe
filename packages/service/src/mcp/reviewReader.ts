/**
 * Real `ReviewReader` over `ReviewStore` + worktree paths (M3 composition).
 *
 * The MCP server only ever reads through this narrow interface (PRD §10):
 * review hunks/cards/annotations/contributions/description for
 * `get_hunk`/`search_review`/`resolve`, plus the worktree path for
 * `get_code`. Worktrees live at `<dataDir>/worktrees/<reviewId>` (see
 * `ingest/source.ts` `ensureWorktree`); demo reviews reuse the same layout
 * (their head files are materialized from the fixture diff, #176, and
 * `get_code` serves them from disk — see `read.ts`).
 */
import fs from "node:fs";
import path from "node:path";
import type { ContextRepoRef } from "@unvibe/shared";
import { documentBlockText, isDocumentReview, isReadySnapshot, renderMarkdown } from "@unvibe/shared";
import { currentDescriptionHtml, parseDescriptionParagraphs } from "../ingest/description.js";
import type { ReviewStore } from "../state/store.js";
import type { McpReviewData, ReviewReader } from "./read.js";

export interface StoreReaderOptions {
  reviews: ReviewStore;
  dataDir: string;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export class StoreReviewReader implements ReviewReader {
  constructor(private readonly opts: StoreReaderOptions) {}

  async getReview(reviewId: string): Promise<McpReviewData | null> {
    const snap = this.opts.reviews.getSnapshot(reviewId);
    if (!snap || !isReadySnapshot(snap)) return null;
    const hunks = snap.files.flatMap((f) =>
      f.hunks.map((h) => ({
        fileKey: f.fileKey,
        path: f.path,
        contentHash: h.contentHash,
        header: h.header,
        newStart: h.newStart,
        newEnd: h.newEnd,
        text: h.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`).join("\n"),
      })),
    );
    const cards = snap.pages.flatMap((p) =>
      p.cards.map((c) => ({
        id: c.id,
        title: c.title,
        text: plainText(renderMarkdown(c.blocks)),
      })),
    );
    // Issue #222: the document is searchable/resolvable like a card.
    if (snap.document) {
      cards.push({
        id: "document",
        title: snap.document.title,
        text: snap.document.blocks.map((b) => `[doc:${b.id}] ${documentBlockText(b)}`).join("\n\n"),
      });
    }
    // Issue #143: agents read explanation text through the review tools.
    // Conversation answers are blocks, rendered like cards; comments
    // contribute their messages.
    const annotations = snap.annotations.map((a) => ({
      id: a.id,
      type: a.type,
      anchorSummary: a.anchor.quotedText.slice(0, 80),
      text:
        a.type === "conversation"
          ? (a.turns ?? [])
              .map((t) => `${t.question === null ? "Explain this." : t.question}\n${plainText(renderMarkdown(t.blocks))}`)
              .join("\n\n")
          : a.messages.map((m) => m.text ?? "").join("\n"),
    }));
    const contributions = snap.contributions.flatMap((c) =>
      c.items.map((it) => ({
        id: c.id,
        sourceSession: c.sourceSession,
        text: it.text,
      })),
    );
    // Description paragraphs: IDs come from the stored HTML via the
    // single source (`parseDescriptionParagraphs`, issue #96), so MCP
    // search/resolve hand out exactly the IDs ingest assigned.
    const description = parseDescriptionParagraphs(currentDescriptionHtml(snap.description));
    return {
      reviewId,
      headSha: snap.version.headSha,
      hunks,
      cards,
      annotations,
      contributions,
      description,
    };
  }

  /** Issue #222: a document review's context repos (sha resolution source). */
  getContextRepos(reviewId: string): ContextRepoRef[] | null {
    const snap = this.opts.reviews.getSnapshot(reviewId);
    if (snap && isDocumentReview(snap)) return snap.contextRepos;
    return null;
  }

  getWorktreePath(reviewId: string): string | null {
    // Issue #222: document reviews read code from their first context repo.
    const snap = this.opts.reviews.getSnapshot(reviewId);
    if (snap && isDocumentReview(snap)) {
      return snap.contextRepos[0]?.repoPath ?? null;
    }
    const wt = path.join(this.opts.dataDir, "worktrees", reviewId);
    try {
      if (fs.existsSync(wt)) return wt;
    } catch {
      return null;
    }
    return null;
  }
}
