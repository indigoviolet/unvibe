import { describe, expect, it } from "vitest";
import { validateDiagram } from "../src/content/diagram-spec.js";

const FLOW = {
  version: 1,
  kind: "flow",
  title: "Header data flow",
  nodes: [
    { id: "srv", title: "Server", sub: "folded header", col: 0 },
    { id: "norm", title: "normalize", cite: "diff:conn:91-110", col: 1, state: "ok" },
  ],
  edges: [{ from: "srv", to: "norm", label: "parse" }],
};

describe("validateDiagram", () => {
  it("accepts the flow, panels and sequence forms", () => {
    expect(validateDiagram(FLOW).ok).toBe(true);
    expect(
      validateDiagram({
        version: 1,
        kind: "panels",
        title: "Before/after",
        panels: [
          { title: "Before", lines: ["a"], cite: "diff:conn:80-82" },
          { title: "After", lines: ["b"], state: "ok" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      validateDiagram({
        version: 1,
        kind: "sequence",
        title: "Calls",
        actors: ["A", "B", "C", "D"],
        messages: [{ from: 0, to: 1, label: "hi", cite: "diff:conn:80-82" }],
      }).ok,
    ).toBe(true);
  });

  it("rejects unknown fields with a clear message", () => {
    const v = validateDiagram({ ...FLOW, bogus: 1 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/unknown field/);
    const n = validateDiagram({
      ...FLOW,
      nodes: [{ id: "a", title: "A", nope: 1 }],
      edges: [],
    });
    expect(n.ok).toBe(false);
    expect(n.errors.join(" ")).toMatch(/unknown field/);
  });

  it("enforces caps and label lengths", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `n-${i}`, title: "T" }));
    expect(validateDiagram({ ...FLOW, nodes: many, edges: [] }).ok).toBe(false);
    const long = validateDiagram({
      ...FLOW,
      nodes: [{ id: "a", title: "x".repeat(49) }],
      edges: [],
    });
    expect(long.ok).toBe(false);
  });

  it("rejects bad cites, ids, endpoints and self-edges", () => {
    expect(validateDiagram({ ...FLOW, nodes: [{ id: "Bad!", title: "T" }], edges: [] }).errors.join(" ")).toMatch(/bad id/);
    expect(
      validateDiagram({ ...FLOW, edges: [{ from: "srv", to: "nope" }] }).errors.join(" "),
    ).toMatch(/unknown endpoint/);
    expect(
      validateDiagram({ ...FLOW, edges: [{ from: "srv", to: "srv" }] }).errors.join(" "),
    ).toMatch(/self-edge/);
    const badCite = validateDiagram({
      ...FLOW,
      nodes: [{ id: "a", title: "A", cite: "not-a-cite" }],
      edges: [],
    });
    expect(badCite.ok).toBe(false);
    expect(badCite.errors.join(" ")).toMatch(/bad cite/);
  });

  it("rejects tokens inside titles and accepts neutral state", () => {
    const tok = validateDiagram({
      ...FLOW,
      nodes: [{ id: "a", title: "A [[diff:conn:1]]" }],
      edges: [],
    });
    expect(tok.ok).toBe(false);
    const neutral = validateDiagram({
      ...FLOW,
      nodes: [{ id: "a", title: "A", state: "neutral" }],
      edges: [],
    });
    expect(neutral.ok).toBe(true);
  });

  it("requires exactly 2 panels and valid actor indexes", () => {
    expect(
      validateDiagram({ version: 1, kind: "panels", title: "T", panels: [{ title: "Only", lines: ["a"] }] }).ok,
    ).toBe(false);
    const seq = validateDiagram({
      version: 1,
      kind: "sequence",
      title: "S",
      actors: ["A", "B"],
      messages: [{ from: 0, to: 9, label: "x" }],
    });
    expect(seq.ok).toBe(false);
    expect(seq.errors.join(" ")).toMatch(/actor indexes/);
  });

  it("reports invalid JSON sentinel from the parser", () => {
    const v = validateDiagram({ __parseError: "Unexpected token" });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/invalid JSON/);
  });

  it("collects cites in document order", () => {
    const v = validateDiagram(FLOW);
    expect(v.cites).toEqual(["diff:conn:91-110"]);
  });
});
