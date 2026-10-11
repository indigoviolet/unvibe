/**
 * Diagram citation markers: cited nodes/edges/panels render `<>` badges
 * with the standard hooks, keyboard reachable, unverified dimmed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DiagramSpec } from "@unvibe/shared";
import { DiagramSvg } from "./DiagramSvg.js";

vi.mock("../source/reveal.js", () => ({ revealSource: vi.fn() }));
import { revealSource } from "../source/reveal.js";

const SPEC: DiagramSpec = {
  version: 1,
  kind: "flow",
  title: "Flow",
  nodes: [
    { id: "a", title: "wire", cite: "diff:conn:80-82", col: 0 },
    { id: "b", title: "clean", col: 1 },
  ],
  edges: [{ from: "a", to: "b", label: "parse", cite: "diff:conn:91-110" }],
};

describe("DiagramSvg citations", () => {
  it("renders <> badges with data-refs/data-src and keyboard hooks", () => {
    const { container } = render(<DiagramSvg spec={SPEC} />);
    const badges = container.querySelectorAll("[data-cite-badge]");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    for (const b of badges) {
      expect(b.getAttribute("data-refs")).toBeTruthy();
      expect(b.getAttribute("data-src")).toBeTruthy();
      expect(b.getAttribute("tabindex")).toBe("0");
      expect(b.getAttribute("role")).toBe("button");
    }
    const groups = container.querySelectorAll("g[data-cite]");
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking a badge reveals its source", () => {
    const { container } = render(<DiagramSvg spec={SPEC} />);
    const badge = container.querySelector('[data-cite-badge="diff:conn:80-82"]') as Element;
    fireEvent.click(badge);
    expect(revealSource).toHaveBeenCalledWith("diff:conn:80-82");
  });

  it("dims unverified cites with a tooltip", () => {
    const { container } = render(<DiagramSvg spec={SPEC} unverified={["diff:conn:80-82"]} />);
    const badge = container.querySelector('[data-cite-badge="diff:conn:80-82"]') as Element;
    expect(badge.getAttribute("class") ?? "").toContain("unverified");
    expect(badge.innerHTML).toContain("Unverified citation");
  });

  it("falls back to source on invalid spec", () => {
    render(<DiagramSvg spec={{ version: 1, kind: "flow", title: "", nodes: [], edges: [] } as unknown as DiagramSpec} />);
    expect(screen.getByText(/could not be rendered/)).toBeTruthy();
  });
});
