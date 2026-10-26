/**
 * Paragraph-by-paragraph answers (issue #126, experiment).
 *
 * While a unified Explain/Ask turn fills, completed paragraphs appear as
 * they arrive — never half sentences. The stored turn replaces the
 * provisional content when it lands (validated, citations resolved), so a
 * repair turn also replaces cleanly.
 *
 * Deliberately narrow:
 * - Only answer CONTENT streams; the working indicator stays a fixed
 *   label (issue #46 is revisited for content only).
 * - Provisional blocks render paragraph/list/table/code/finding-link/
 *   comment-link only. Diagrams need the server render, follow-ups would
 *   act on a still-filling turn, and asides ride with them — all three
 *   arrive with the finished answer.
 * - Provisional citations render through the normal markers inside a
 *   `.streaming` wrapper that dims them as pending; they resolve when the
 *   stored turn lands. No validation runs on provisional text.
 * - Guide cards and hunk summaries never read streams (different
 *   components); only conversation answers do.
 * - Kill switch for trying/comparing: localStorage
 *   `unvibe:no-stream-paragraphs = "1"` restores all-at-once answers.
 */
import { useEffect, useMemo } from "react";
import type { Block, Reply } from "@unvibe/shared";
import { parseBlocks, splitStreamText } from "@unvibe/shared";
import { useReview } from "../../state/store.js";

/** Block types safe to show before validation (see module doc). */
const PROVISIONAL_TYPES = new Set([
  "paragraph",
  "list",
  "table",
  "code",
  "finding-link",
  "comment-link",
]);

/** Experiment kill switch (default on; set to "1" for today's behaviour). */
export function streamingEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("unvibe:no-stream-paragraphs") !== "1";
  } catch {
    return true;
  }
}

/**
 * Provisional blocks for a filling turn, or null when there is nothing
 * provisional to show (disabled, not filling, no completed paragraph, or
 * the stored turn already arrived — stored content always wins).
 * Block ids (`stream-b1…`) are stable across stream updates because the
 * completed prefix only grows.
 */
export function useProvisionalBlocks(cardId: string, turn: Reply, live: boolean): Block[] | null {
  const stream = useReview((s) => s.streams[cardId]);
  const clearStream = useReview((s) => s.clearStream);
  const text = stream?.text ?? "";
  const settled = turn.blocks.length > 0 || !!turn.error;
  const blocks = useMemo((): Block[] | null => {
    if (!streamingEnabled() || !live || settled || !text) return null;
    const { completed } = splitStreamText(text);
    if (completed.length === 0) return null;
    try {
      const parsed = parseBlocks(completed.join("\n\n"), { idPrefix: "stream-" });
      const shown = parsed.filter((b) => PROVISIONAL_TYPES.has(b.type));
      return shown.length > 0 ? shown : null;
    } catch {
      // A prefix the parser rejects stays a working state, never an error.
      return null;
    }
  }, [text, live, settled, turn.blocks.length, turn.error]);
  useEffect(() => {
    if (!stream) return;
    if (settled || !live) clearStream(cardId);
  }, [stream, settled, live, cardId, clearStream]);
  return blocks;
}
