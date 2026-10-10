/**
 * Real `ReviewReader` over `ReviewStore` + worktree paths (M3 composition).
 *
 * The MCP server only ever reads through this narrow interface (PRD §10):
 * review hunks/cards/annotations/contributions/description for
 * `get_hunk`/`search_review`/`resolve`, plus the worktree path for
 * `get_code`. Worktrees live at `<dataDir>/worktrees/<reviewId>` (see
 * `ingest/source.ts` `ensureWorktree`); demo reviews reuse the same layout
 * (their files are the fixture diff, served from the snapshot, and
 * `get_code` falls back to null when no worktree exists).
 */
import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "@unvibe/shared";
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
    if (!snap) return null;
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
    const annotations = snap.annotations.map((a) => ({
      id: a.id,
      type: a.type,
      anchorSummary: a.anchor.quotedText.slice(0, 80),
      text: a.messages.map((m) => m.text ?? m.html ?? "").join("\n"),
    }));
    const contributions = snap.contributions.flatMap((c) =>
      c.items.map((it) => ({
        id: c.id,
        sourceSession: c.sourceSession,
        text: it.text,
      })),
    );
    // Description paragraphs: re-derive ids from stored HTML headings?
    // The validator's snapshot lookup uses descTexts supplied by the
    // pipeline; for MCP search we expose the whole description as one item
    // per paragraph id found in the HTML (`id="..."` or fallback d-pN).
    const description = descItems(snap.description?.html ?? "");
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

  getWorktreePath(reviewId: string): string | null {
    const wt = path.join(this.opts.dataDir, "worktrees", reviewId);
    try {
      if (fs.existsSync(wt)) return wt;
    } catch {
      return null;
    }
    return null;
  }
}

function descItems(html: string): { id: string; text: string }[] {
  if (!html) return [];
  // Split on paragraph boundaries; ids are stable (`desc:<id>` tokens
  // resolve via the pipeline's descTexts, not here).
  const paras = html.split(/<\/(?:p|li|h\d)>/i).map((s) => plainText(s)).filter(Boolean);
  return paras.map((text, i) => ({ id: `d-p${i + 1}`, text }));
}
