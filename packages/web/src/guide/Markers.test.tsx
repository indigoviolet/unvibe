/**
 * Rendering tests for citation markers and counts (PRD §4.5) + footnote
 * chips (issue #72, PRD §4.7): grouped `<>` marker with a count when >1,
 * separate dimmed markers for unverified citations, the speech-bubble
 * comment marker (only for threads that never had a quote), and footnote
 * chips for closed expansions / links / quoted threads sharing the
 * citations line.
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

  it("quoted threads get footnote chips, not the bubble marker", () => {
    const threads: Annotation[] = [
      {
        id: "tq",
        type: "thread",
        anchor: {
          host: { kind: "block", blockId: "b" },
          quotedText: "Draw the Stereo vs mono-mix",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        messages: [],
        post: false,
        note: false,
      },
      {
        id: "tn",
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
      },
    ];
    const { container } = render(<BlockMarkers citations={[]} threads={threads} blockId="b" />);
    // Bare bubble holds only the never-quoted thread.
    const marker = screen.getByRole("button", { name: "1 comments" });
    expect(marker).toHaveAttribute("data-threads", "tn");
    // Quoted thread is a hidden footnote chip with its quote.
    const chip = container.querySelector("mark.fnote.th[data-thr='tq']");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-tfallback")).toBe("tq");
    expect(chip?.getAttribute("title")).toBe("Draw the Stereo vs mono-mix");
    expect(chip?.hasAttribute("hidden")).toBe(true);
  });

  it("closed expansions and links render footnote chips on the same row", () => {
    const footnotes: Annotation[] = [
      {
        id: "e1",
        type: "expansion",
        anchor: {
          host: { kind: "block", blockId: "b" },
          quotedText: "Draw the Stereo vs mono-mixdown with a very long quote for truncation",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        messages: [],
        post: false,
        note: false,
      },
      {
        id: "l1",
        type: "link",
        anchor: {
          host: { kind: "block", blockId: "b" },
          quotedText: "channel_correlation computes a value",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        messages: [],
        post: false,
        note: false,
        promotedToPage: "p1",
      },
    ];
    const { container } = render(
      <BlockMarkers citations={[rc("diff:conn:82")]} threads={[]} footnotes={footnotes} blockId="b" onOpenPage={() => {}} />,
    );
    const row = container.querySelector(".lo");
    expect(row).not.toBeNull();
    // Citations chip + both footnote chips share one row.
    expect(row?.querySelector("button.lk[data-refs]")).not.toBeNull();
    const exp = row?.querySelector("mark.fnote.exl[data-jump='e1']");
    expect(exp?.getAttribute("data-fallback")).toBe("e1");
    expect(exp?.getAttribute("title")).toMatch(/Stereo/);
    expect(exp?.hasAttribute("hidden")).toBe(true);
    const link = row?.querySelector("a.fnote[data-node='p1']");
    expect(link?.getAttribute("data-fallback")).toBe("l1");
    expect(link?.textContent).toMatch(/channel_correlation/);
  });
});
