/**
 * Debug Markdown renderer (issue #32): headings, lists, fenced code, and
 * inline code/bold render; diff/code lines (`#` comments, `[seq kind
 * scope]` log lines) stay literal; HTML is never interpreted.
 */
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView.js";

function show(markdown: string): HTMLElement {
  cleanup();
  const { container } = render(<MarkdownView markdown={markdown} />);
  return container;
}

describe("MarkdownView", () => {
  it("renders headings, lists, and paragraphs", () => {
    const el = show("## Base\n\n- version: `v1`\n- appended: 0\n\nSome text.");
    expect(el.querySelector("h2")).toHaveTextContent("Base");
    expect(el.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Some text.")).toBeInTheDocument();
  });

  it("keeps fenced code exact, including inner fences and hash lines", () => {
    const el = show("#### L1 + L1b + L2\n\n````text\n# divider one\n```python\nx = 1\n```\n````\n");
    const pre = el.querySelector("pre.code code");
    expect(pre?.textContent).toContain("# divider one");
    expect(pre?.textContent).toContain("```python");
    // No heading was born from the `#` comment inside the fence.
    expect(el.querySelectorAll("h2, h3, h4")).toHaveLength(1);
  });

  it("keeps log lines literal and escapes HTML", () => {
    const el = show("- [1 new-card global] central card written · in base\n\n<script>alert(1)</script>");
    expect(screen.getByText(/central card written · in base/)).toBeInTheDocument();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>");
  });

  it("renders inline code and bold", () => {
    const el = show("- **fact** → `card:c#b`: some text");
    expect(el.querySelector("strong")).toHaveTextContent("fact");
    expect(el.querySelector("code")).toHaveTextContent("card:c#b");
  });
});
