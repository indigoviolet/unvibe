import { describe, expect, it } from "vitest";
import { criticApplyAll } from "../src/pipeline/apply.js";
import type { Block } from "@unvibe/shared";

function cards(...spec: [string, string][]): { title: string | null; blocks: Block[] }[] {
  return spec.map(([title, text]) => ({
    title,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] } as Block],
  }));
}

describe("critic reply split (#215)", () => {
  it("splits one reply into two findings with per-finding metadata", () => {
    const out = criticApplyAll(
      cards(["Evidence", "e1"], ["Assessment", "a1"], ["Evidence", "e2"], ["Assessment", "a2"]),
      {
        findings: [
          { title: "First", confidence: "high", summary: "s1", cardIds: ["f1-ev", "f1-as"], suggestedComment: { text: "t1", diff: "diff:conn:1" } },
          { title: "Second", confidence: "low", summary: "s2", cardIds: ["f2-ev", "f2-as"] },
        ],
      },
      "f-critic",
    );
    expect(out.map((f) => [f.pageId, f.title, f.confidence])).toEqual([
      ["f-critic", "First", "high"],
      ["f-critic-2", "Second", "low"],
    ]);
    expect(out[0].cards.map((c) => c.id)).toEqual(["f1-ev", "f1-as"]);
    expect(out[1].cards.map((c) => c.id)).toEqual(["f2-ev", "f2-as"]);
    expect(out[0].suggestedComment).toEqual({ text: "t1", diff: "diff:conn:1" });
    expect(out[1].suggestedComment).toBeUndefined();
  });

  it("uses recorded ids when the findings carry them (demo f-lf/f-perf)", () => {
    const out = criticApplyAll(
      cards(["Evidence", "e1"], ["Assessment", "a1"], ["Evidence", "e2"], ["Assessment", "a2"]),
      { findings: [{ id: "f-lf", title: "LF", cardIds: ["flf-ev", "flf-as"] }, { id: "f-perf", title: "Perf", cardIds: ["fpf-ev", "fpf-as"] }] },
      "f-critic",
    );
    expect(out.map((f) => f.pageId)).toEqual(["f-lf", "f-perf"]);
  });

  it("zero findings is a valid silent reply", () => {
    expect(criticApplyAll([], { findings: [] }, "f-critic")).toEqual([]);
    expect(criticApplyAll([], null, "f-critic")).toEqual([]);
  });

  it("keeps every finding the critic returns (owner: no cap)", () => {
    const many = cards(
      ["Evidence", "e1"], ["Assessment", "a1"],
      ["Evidence", "e2"], ["Assessment", "a2"],
      ["Evidence", "e3"], ["Assessment", "a3"],
      ["Evidence", "e4"], ["Assessment", "a4"],
    );
    const out = criticApplyAll(many, { findings: [{ title: "1" }, { title: "2" }, { title: "3" }, { title: "4" }] }, "f-critic");
    expect(out.map((f) => f.title)).toEqual(["1", "2", "3", "4"]);
  });

  it("a single legacy finding trailer is one finding", () => {
    const out = criticApplyAll(cards(["Evidence", "e"], ["Assessment", "a"]), { title: "Solo", finding: { confidence: "medium", summary: "s" } }, "f-critic");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Solo");
  });

  it("drops a finding with no usable cards, keeps the rest", () => {
    const out = criticApplyAll(
      cards(["Evidence", "e1"], ["Assessment", "a1"]),
      { findings: [{ title: "Kept" }, { title: "Empty" }] },
      "f-critic",
    );
    expect(out.map((f) => f.title)).toEqual(["Kept"]);
  });
});
