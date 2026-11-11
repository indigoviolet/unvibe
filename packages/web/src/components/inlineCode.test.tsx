import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { InlineCode, stripCodeSpans } from "./inlineCode.js";

afterEach(() => {
  cleanup();
});

describe("stripCodeSpans", () => {
  it("drops the backticks around code spans", () => {
    expect(stripCodeSpans("Add the `some_guard` for retries")).toBe("Add the some_guard for retries");
  });
  it("leaves text without spans alone", () => {
    expect(stripCodeSpans("Retry failed uploads")).toBe("Retry failed uploads");
  });
  it("leaves an unclosed backtick alone", () => {
    expect(stripCodeSpans("Add the `some_guard")).toBe("Add the `some_guard");
  });
});

describe("InlineCode", () => {
  // Issue #381: follow-up chips render labels through InlineCode — code
  // spans only, with the same escaping as everywhere else.
  it("renders backticked spans as code with no literal backticks", () => {
    render(<InlineCode text="Does `del message[name]` keep casing?" />);
    const code = screen.getByText("del message[name]");
    expect(code.tagName).toBe("CODE");
    expect(screen.getByText(/Does/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("`");
  });
  it("escapes markup instead of rendering it", () => {
    render(<InlineCode text="What does `<b>bold</b>` & `a&b` mean?" />);
    expect(document.body.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(screen.getByText("a&b")).toBeInTheDocument();
  });
  it("leaves an unclosed backtick as plain text", () => {
    render(<InlineCode text="Add the `some_guard" />);
    expect(screen.getByText(/Add the/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("`some_guard");
  });
});
