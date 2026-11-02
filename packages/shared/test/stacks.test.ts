import { describe, expect, it } from "vitest";
import { inferStacks, stackColorIndex, STACK_PALETTE, type StackPrInput } from "../src/index.js";

const pr = (number: number, head: string, base: string, extra: Partial<StackPrInput> = {}): StackPrInput => ({
  number, title: `PR ${number}`, headRefName: head, baseRefName: base, ...extra,
});
const KEY = "acme/widgets";

describe("inferStacks (#321)", () => {
  it("linear 3-stack positions and shared colour/root", () => {
    const m = inferStacks([pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "b")], KEY);
    expect(m.get(1)).toMatchObject({ position: 1, size: 3, rootNumber: 1 });
    expect(m.get(2)).toMatchObject({ position: 2, size: 3, rootNumber: 1 });
    expect(m.get(3)).toMatchObject({ position: 3, size: 3, rootNumber: 1 });
    expect(m.get(1)!.colorIndex).toBe(m.get(3)!.colorIndex);
    expect(m.get(2)!.members.map((x) => x.number)).toEqual([1, 2, 3]);
  });
  it("default-branch PRs are not stacked", () => {
    expect(inferStacks([pr(1, "a", "main"), pr(2, "b", "main")], KEY).size).toBe(0);
  });
  it("broken chain: parent merged/closed shrinks stack", () => {
    const m = inferStacks([pr(2, "b", "a"), pr(3, "c", "b")], KEY);
    expect(m.get(2)).toMatchObject({ position: 1, size: 2, rootNumber: 2 });
    expect(m.get(3)).toMatchObject({ position: 2, size: 2 });
  });
  it("single remaining PR after break is not stacked", () => {
    expect(inferStacks([pr(3, "c", "b")], KEY).size).toBe(0);
  });
  it("fork: siblings shown, position along own chain", () => {
    const m = inferStacks([pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "a")], KEY);
    expect(m.get(2)).toMatchObject({ position: 2, siblings: [3] });
    expect(m.get(3)).toMatchObject({ position: 2, siblings: [2] });
    expect(m.get(1)!.size).toBe(2);
  });
  it("cycle does not hang and caps", () => {
    const m = inferStacks([pr(1, "a", "b"), pr(2, "b", "a")], KEY);
    for (const v of m.values()) expect(v.size).toBeLessThanOrEqual(50);
  });
  it("long chain capped at 50", () => {
    const prs = Array.from({ length: 60 }, (_, i) => pr(i + 1, `b${i + 1}`, i === 0 ? "main" : `b${i}`));
    const m = inferStacks(prs, KEY);
    expect(m.get(60)!.position).toBeLessThanOrEqual(51);
  });
  it("fork head cannot be a parent by branch name", () => {
    const m = inferStacks([pr(1, "a", "main", { isCrossRepository: true }), pr(2, "b", "a")], KEY);
    expect(m.size).toBe(0);
  });
  it("fork PR can still stack on a same-repo parent", () => {
    const m = inferStacks([pr(1, "a", "main"), pr(2, "b", "a", { isCrossRepository: true })], KEY);
    expect(m.get(2)).toMatchObject({ position: 2, size: 2 });
  });
});

describe("stack colour (#321)", () => {
  it("stable and within palette", () => {
    expect(stackColorIndex("acme/widgets#1")).toBe(stackColorIndex("acme/widgets#1"));
    for (let i = 1; i <= 40; i++) {
      const idx = stackColorIndex(`acme/widgets#${i}`);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(STACK_PALETTE.length);
    }
  });
  it("distinct across neighbouring roots and legible pairs differ", () => {
    const seen = new Set(Array.from({ length: 8 }, (_, i) => stackColorIndex(`acme/widgets#${i + 1}`)));
    expect(seen.size).toBeGreaterThan(3);
    for (const p of STACK_PALETTE) {
      expect(p.light.bg).not.toBe(p.light.fg);
      expect(p.dark.bg).not.toBe(p.dark.fg);
    }
  });
});
