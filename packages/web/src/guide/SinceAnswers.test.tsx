/** Issue #351 review: feedback links render visibly; the addendum prefix strips defensively. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SinceAnswers, stripAddendumPrefix } from "./SinceAnswers.js";

describe("stripAddendumPrefix", () => {
  it("strips the dated header echo", () => {
    expect(stripAddendumPrefix("Updated since v1: alpha returns 111 now.")).toBe("alpha returns 111 now.");
    expect(stripAddendumPrefix("Updated since v12 · 4 Nov — the value changed.")).toBe("the value changed.");
    expect(stripAddendumPrefix("updated since v2 - done.")).toBe("done.");
  });
  it("leaves other prose alone", () => {
    expect(stripAddendumPrefix("Alpha returns 111 now.")).toBe("Alpha returns 111 now.");
    expect(stripAddendumPrefix("Not updated since anything.")).toBe("Not updated since anything.");
  });
});

describe("SinceAnswers", () => {
  it("renders nothing without answers", () => {
    const { container } = render(<SinceAnswers answers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("links remote remarks out and threads to the page", () => {
    render(
      <SinceAnswers
        answers={[
          { kind: "comment", label: "@reviewer on a.py:11", excerpt: "Should return 11 here.", url: "https://example.test/pr/1#c7" },
          { kind: "thread", label: "Thread t-1", excerpt: "Agreed, fix alpha.", url: "#t-1" },
          { kind: "commit", label: "abc1234 rework alpha", excerpt: "The reviewer asked for 11." },
        ]}
      />,
    );
    expect(screen.getByText("Answers:")).toBeVisible();
    const remote = screen.getByRole("link", { name: /Should return 11 here/ });
    expect(remote).toHaveAttribute("href", "https://example.test/pr/1#c7");
    expect(remote.textContent).toContain("↗");
    expect(screen.getByRole("link", { name: /Agreed, fix alpha/ })).toHaveAttribute("href", "#t-1");
    expect(screen.getByText(/The reviewer asked for 11/)).toBeVisible();
  });
});
