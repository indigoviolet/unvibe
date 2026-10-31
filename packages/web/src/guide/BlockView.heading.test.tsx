/**
 * Sub-heading rendering (issue #327): a heading block renders as a real
 * <h3> with the subhead style, not as serif body prose.
 */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { Block, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { BlockView } from "./BlockView.js";

function seed(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: "r1", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("BlockView heading (#327)", () => {
  it("renders a heading block as an h3.subhead with its inline HTML", () => {
    seed();
    const block: Block = { type: "heading", id: "b2", html: "Interfaces with <strong>reach</strong>", citations: [] };
    const { container } = render(
      <BlockView block={block} level="standard" threads={[]} cardId="c1" onOpenPage={() => {}} onFollowUp={() => {}} />,
    );
    const h = container.querySelector("h3.subhead");
    expect(h).not.toBeNull();
    expect(h?.textContent).toBe("Interfaces with reach");
    expect(h?.querySelector("strong")?.textContent).toBe("reach");
    expect(container.querySelector("p.prose")).toBeNull();
    expect(container.querySelector(".blk")?.id).toBe("B-b2");
  });
});
