/**
 * Mock-action tests: read/collapse toggle locally, depth switches to the
 * depth text already in the fixture (+ principle at the deepest level),
 * undo restores, generate fills from canned content with job progress.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGuideSnapshot } from "../src/mock/loadGuideFixture.js";
import { mockAction } from "../src/mock/mockActions.js";
import { useReview } from "../src/state/store.js";

vi.stubEnv("VITE_MOCK", "1");

function load(): void {
  useReview.getState().setSnapshot(buildGuideSnapshot("demo"));
}

function card(id: string) {
  const snap = useReview.getState().snapshot;
  return snap?.pages.flatMap((p) => p.cards).find((c) => c.id === id);
}

beforeEach(() => {
  load();
});

describe("mock read/collapse", () => {
  it("read greys and collapses; unmarking keeps it expanded", async () => {
    await mockAction("demo", { kind: "read", cardId: "problem", read: true });
    expect(card("problem")?.read).toBe(true);
    expect(card("problem")?.collapsed).toBe(true);
    await mockAction("demo", { kind: "read", cardId: "problem", read: false });
    expect(card("problem")?.read).toBe(false);
    // Unmarking expands (prototype: collapsed = read).
    await mockAction("demo", { kind: "collapse", cardId: "problem", collapsed: false });
    expect(card("problem")?.collapsed).toBe(false);
  });
});

describe("mock depth", () => {
  it("switches to the canned depth text", async () => {
    await mockAction("demo", { kind: "depth", cardId: "problem", direction: "simpler" });
    expect(card("problem")?.level).toBe("simple");
    await mockAction("demo", { kind: "depth", cardId: "problem", direction: "deeper" });
    expect(card("problem")?.level).toBe("standard");
  });

  it("adds an Underlying principle aside past the deepest level", async () => {
    await mockAction("demo", { kind: "depth", cardId: "problem", direction: "deeper" });
    await mockAction("demo", { kind: "depth", cardId: "problem", direction: "deeper" });
    const c = card("problem");
    expect(c?.level).toBe("deep");
    expect(c?.blocks.some((b) => b.type === "aside" && b.kind === "Underlying principle")).toBe(true);
  });

  it("undo restores the previous level and blocks", async () => {
    await mockAction("demo", { kind: "depth", cardId: "problem", direction: "simpler" });
    expect(card("problem")?.level).toBe("simple");
    await mockAction("demo", { kind: "undo", cardId: "problem" });
    expect(card("problem")?.level).toBe("standard");
  });
});

describe("mock generate", () => {
  it("fills a Go deeper card from canned content", async () => {
    const res = await mockAction("demo", { kind: "generate", cardId: "g-flow" });
    expect(res.accepted).toBe(true);
    const c = card("g-flow");
    expect(c?.pending).toBeUndefined();
    expect(c?.title).toBe("Data flow: from the socket to HTTPHeaderDict");
    expect(c?.blocks.length).toBeGreaterThan(0);
    const jobs = useReview.getState().snapshot?.jobs ?? [];
    expect(jobs.find((j) => j.cardId === "g-flow")?.state).toBe("done");
  }, 10000);
});
