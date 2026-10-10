/**
 * Rendering tests for citation markers and counts (PRD §4.5): grouped `<>`
 * marker with a count when >1, separate dimmed markers for unverified
 * citations, and the speech-bubble comment marker with its count.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Annotation } from "@unvibe/shared";
import { BlockMarkers } from "./Markers.js";
import type { ResolvedCitation } from "./citations.js";

const rc = (target: string, unverified = false): ResolvedCitation => ({
  target,
  label: target,
  snippet: "snippet",
  ...(unverified ? { unverified: true } : {}),
});

describe("BlockMarkers", () => {
  it("renders nothing without citations or threads", () => {
    const { container } = render(<BlockMarkers citations={[]} threads={[]} blockId="b" />);
    expect(container.querySelector(".lo")).toBeNull();
  });

  it("renders one marker without a count for a single citation", () => {
    render(<BlockMarkers citations={[rc("diff:conn:82")]} threads={[]} blockId="b" />);
    const marker = screen.getByRole("button", { name: "Source" });
    expect(marker).toHaveAttribute("data-refs", "diff:conn:82");
    expect(marker.textContent).not.toMatch(/\d/);
  });

  it("groups verified citations into one marker with a count", () => {
    render(
      <BlockMarkers
        citations={[rc("diff:conn:82"), rc("diff:conn:86"), rc("desc:d-p1")]}
        threads={[]}
        blockId="b"
      />,
    );
    const marker = screen.getByRole("button", { name: "3 sources" });
    expect(marker).toHaveAttribute("data-refs", "diff:conn:82|diff:conn:86|desc:d-p1");
    expect(marker.textContent).toContain("3");
  });

  it("dims each unverified citation separately with a tooltip", () => {
    const { container } = render(
      <BlockMarkers
        citations={[rc("diff:conn:82"), rc("diff:conn:99", true)]}
        threads={[]}
        blockId="b"
      />,
    );
    const verified = container.querySelector("button.lk:not(.unverified):not(.cm)");
    expect(verified).toHaveAttribute("data-refs", "diff:conn:82");
    const unverified = container.querySelector("button.lk.unverified");
    expect(unverified).toHaveAttribute("data-refs", "diff:conn:99");
    expect(unverified?.getAttribute("data-tip")).toMatch(/could not be checked/i);
  });

  it("renders the comment marker with a count", () => {
    const threads: Annotation[] = ["t1", "t2"].map((id) => ({
      id,
      type: "thread",
      anchor: {
        host: { kind: "block", blockId: "b" },
        quotedText: "",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: false,
      messages: [],
      post: false,
      note: false,
    }));
    render(<BlockMarkers citations={[]} threads={threads} blockId="b" />);
    const marker = screen.getByRole("button", { name: "2 comments" });
    expect(marker).toHaveAttribute("data-threads", "t1|t2");
    expect(marker.textContent).toContain("2");
  });
});
