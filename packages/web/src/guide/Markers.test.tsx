/**
 * Rendering tests for citation markers and counts (PRD §4.5) + footnote
 * chips (issue #72, PRD §4.7): grouped `<>` marker with a count when >1,
 * no marker at all for unverified citations (issue #264), the speech-bubble
 * comment marker (only for threads that never had a quote), and footnote
 * chips for closed expansions / links / quoted threads sharing the
 * citations line.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Thread } from "@unvibe/shared";
import { onOpenBlockThread } from "./annotations.js";
import { BlockMarkers } from "./Markers.js";
import type { ResolvedCitation } from "./citations.js";

const rc = (target: string, unverified = false): ResolvedCitation => ({
  target,
  label: target,
  snippet: "snippet",
  ...(unverified ? { unverified: true } : {}),
});

function mkReply(text: string): import("@unvibe/shared").Reply {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return { id: `ans_${Math.random().toString(36).slice(2, 6)}`, kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: esc }, citations: [] }], level: "standard", revision: 1, undoStack: [] };
}

describe("BlockMarkers", () => {
  it("renders nothing without citations or threads", () => {
    const { container } = render(<BlockMarkers citations={[]} threads={[]} blockId="b" />);
    expect(container.querySelector(".lo")).toBeNull();
  });

  it("renders one marker with a line-range label for a single citation (#274)", () => {
    render(<BlockMarkers citations={[rc("diff:conn:82")]} threads={[]} blockId="b" />);
    const marker = screen.getByRole("button", { name: "Source" });
    expect(marker).toHaveAttribute("data-refs", "diff:conn:82");
    expect(marker).toHaveTextContent("L82");
  });

  it("groups verified citations into one marker with the first line range (#274)", () => {
    render(
      <BlockMarkers
        citations={[rc("diff:conn:82"), rc("diff:conn:86"), rc("desc:d-p1")]}
        threads={[]}
        blockId="b"
      />,
    );
    const marker = screen.getByRole("button", { name: "3 sources" });
    expect(marker).toHaveAttribute("data-refs", "diff:conn:82|diff:conn:86|desc:d-p1");
    expect(marker).toHaveTextContent("L82");
  });

  it("falls back to the count when the first citation has no line range (#274)", () => {
    render(
      <BlockMarkers citations={[rc("desc:d-p1"), rc("desc:d-p2")]} threads={[]} blockId="b" />,
    );
    const marker = screen.getByRole("button", { name: "2 sources" });
    expect(marker).toHaveTextContent("2");
  });

  it("renders no marker for unverified citations", () => {
    const { container } = render(
      <BlockMarkers
        citations={[rc("diff:conn:82"), rc("diff:conn:99", true)]}
        threads={[]}
        blockId="b"
      />,
    );
    const verified = container.querySelector("button.lk:not(.unverified):not(.cm)");
    expect(verified).toHaveAttribute("data-refs", "diff:conn:82");
    expect(container.querySelector("button.lk.unverified")).toBeNull();
    expect(container.querySelector('[data-tip*="confirm"]')).toBeNull();
  });

  it("renders the comment marker with a count", () => {
    const threads: Thread[] = ["t1", "t2"].map((id) => ({
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
      pinned: false,
      replies: [],
      post: false,
    }));
    render(<BlockMarkers citations={[]} threads={threads} blockId="b" />);
    const marker = screen.getByRole("button", { name: "2 comments" });
    expect(marker).toHaveAttribute("data-threads", "t1|t2");
    expect(marker.textContent).toContain("2");
  });

  it("clicking the comment marker opens every comment on the block, in order (#205)", () => {
    const threads: Thread[] = ["t1", "t2", "t3"].map((id) => ({
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
      pinned: false,
      replies: [mkReply(`note ${id}`)],
      post: false,
    }));
    const opened: string[] = [];
    const off = onOpenBlockThread((id) => opened.push(id));
    try {
      render(<BlockMarkers citations={[]} threads={threads} blockId="b" />);
      fireEvent.click(screen.getByRole("button", { name: "3 comments" }));
      expect(opened).toEqual(["t1", "t2", "t3"]);
    } finally {
      off();
    }
  });

  it("quoted comment threads get footnote chips, not the bubble marker", () => {
    const threads: Thread[] = [
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
        pinned: false,
        replies: [mkReply("note tq")],
        post: false,
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
        pinned: false,
        replies: [],
        post: false,
      },
    ];
    const { container } = render(<BlockMarkers citations={[]} threads={threads} blockId="b" />);
    // Bare bubble holds only the never-quoted thread.
    const marker = screen.getByRole("button", { name: "1 comments" });
    expect(marker).toHaveAttribute("data-threads", "tn");
    // Quoted comment thread keeps its hidden footnote chip with its quote.
    const chip = container.querySelector("mark.fnote.th[data-thr='tq']");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-tfallback")).toBe("tq");
    expect(chip?.getAttribute("title")).toBe("Draw the Stereo vs mono-mix");
    expect(chip?.hasAttribute("hidden")).toBe(true);
  });

  it("quoted agent threads render no .th chip (issue #303: no duplicate thread)", () => {
    const agent = (kind: "explain" | "ask"): Thread => ({
      id: `t-${kind}`,
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
      pinned: false,
      replies: [
        {
          ...mkReply(`note ${kind}`),
          kind,
          question: kind === "ask" ? "why?" : null,
        },
      ],
      post: false,
    });
    // Agent threads are marked by ExpansionHighlights with a `footnotes`
    // fallback chip; a `.th` chip here too would show the thread twice,
    // because GuideThreads only ever hides chips for comment threads.
    for (const kind of ["explain", "ask"] as const) {
      const { container, unmount } = render(
        <BlockMarkers citations={[]} threads={[agent(kind)]} blockId="b" />,
      );
      expect(container.querySelector("mark.fnote.th")).toBeNull();
      expect(container.querySelector("[data-tfallback]")).toBeNull();
      expect(container.querySelector(".lo")).toBeNull();
      unmount();
    }
  });

  it("closed expansions and links render footnote chips on the same row", () => {
    const footnotes: Thread[] = [
      {
        id: "e1",
        type: "thread",
        anchor: {
          host: { kind: "block", blockId: "b" },
          quotedText: "Draw the Stereo vs mono-mixdown with a very long quote for truncation",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        pinned: false,
        replies: [],
        post: false,
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
        pinned: false,
        replies: [],
        post: false,
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
