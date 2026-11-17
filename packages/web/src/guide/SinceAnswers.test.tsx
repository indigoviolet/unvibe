/** Issue #351 review: feedback links render visibly; #413: commit-only lines stay hidden. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SinceAnswers } from "./SinceAnswers.js";

describe("SinceAnswers", () => {
  it("renders nothing without answers", () => {
    const { container } = render(<SinceAnswers answers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders nothing for commit-only answers", () => {
    const { container } = render(
      <SinceAnswers
        answers={[{ kind: "commit", label: "abc1234 rework alpha", excerpt: "The reviewer asked for 11." }]}
      />,
    );
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
    expect(screen.queryByText(/The reviewer asked for 11/)).toBeNull();
  });
});
