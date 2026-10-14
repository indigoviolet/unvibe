/**
 * Agents read explanation text through the review tools (#143).
 *
 * `StoreReviewReader.getReview` renders conversation turns (question +
 * answer blocks) into the annotation text agents search, so an agent can
 * no longer restate or contradict an explanation it cannot see. Comments
 * contribute their messages as before.
 */
import { describe, expect, it } from "vitest";
import type { Annotation } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { StoreReviewReader } from "../src/mcp/reviewReader.js";
import { setupReview } from "./m6-helpers.js";

describe("review reader turns (#143)", () => {
  it("returns conversation answer text and comment messages", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const annotations: Annotation[] = [
        {
          id: "ann_conv",
          type: "conversation",
          anchor: {
            host: { kind: "diff-line", fileKey: "a-py", line: 2 },
            quotedText: "y = 2",
            prefix: "",
            suffix: "",
            position: 2,
            version: 1,
          },
          open: true,
          messages: [],
          post: false,
          turns: [
            {
              id: "ans_1",
              question: null,
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "The helper normalizes the value before use." },
                  citations: [],
                },
              ],
              level: "standard",
              revision: 1,
              undoStack: [],
            },
            {
              id: "ans_2",
              question: "What about ordering?",
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "Order is preserved end to end." },
                  citations: [],
                },
              ],
              level: "standard",
              revision: 1,
              undoStack: [],
            },
          ],
        } as unknown as Annotation,
        {
          id: "ann_note",
          type: "comment",
          anchor: {
            host: { kind: "diff-line", fileKey: "a-py", line: 1 },
            quotedText: "x = 1",
            prefix: "",
            suffix: "",
            position: 1,
            version: 1,
          },
          open: true,
          messages: [{ who: "you", text: "Double-check this line." }],
          post: false,
        } as unknown as Annotation,
      ];
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.annotations.push(...(annotations as never[]));
      });
      void snap;

      const reader = new StoreReviewReader({ reviews: ctx.reviews, dataDir: ctx.dataDir });
      const data = await reader.getReview(reviewId);
      expect(data).not.toBeNull();
      const conv = data!.annotations.find((a) => a.id === "ann_conv")!;
      expect(conv.text).toContain("The helper normalizes the value before use.");
      expect(conv.text).toContain("What about ordering?");
      expect(conv.text).toContain("Order is preserved end to end.");
      const note = data!.annotations.find((a) => a.id === "ann_note")!;
      expect(note.text).toContain("Double-check this line.");
    } finally {
      await app.close();
    }
  });
});
