/**
 * Comments menu sections (issue #226): one scrolling list with three
 * disjoint sections — This review (unmarked threads; posted ones return
 * here), Outbox (marked, unposted, with drafts and the #223 export box),
 * On GitHub (read-only threads, keeping the #183 fold and show/hide
 * behaviour under its strong heading). Each heading carries its count;
 * each thread appears once. Document reviews show no GitHub side (#222).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { CommentsMenu } from "./CommentsMenu.js";

// The view PATCH applies straight to the store snapshot, as the server
// echo would; everything else the menu touches is unused here.
vi.mock("../api/client.js", async () => {
  const { useReview: useStore } = await import("../state/store.js");
  return {
    api: {
      updateView: async (_id: string, body: Partial<ReviewSnapshot["viewPrefs"]>) => {
        const s = useStore.getState().snapshot;
        if (s) useStore.getState().setSnapshot({ ...s, viewPrefs: { ...s.viewPrefs, ...body } });
        return { ok: true };
      },
      updateComment: async () => ({ ok: true }),
      prComments: async () => ({ comments: [] }),
      outbox: async () => ({ markdown: "# Comments on demo\n\n## src/app.py:2\n\nOutbox thought\n", filename: "demo-outbox.md", count: 1 }),
    },
    friendlyError: (e: unknown) => String(e),
  };
});

const FILES = [{ fileKey: "appkey", path: "src/app.py", hunks: [] }];

function thread(id: string, text: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id,
    type: "comment",
    anchor: { host: { kind: "diff-line", fileKey: "appkey", line: 2 }, quotedText: "x = 1" },
    open: true,
    pinned: false,
    messages: [{ who: "you", text }],
    post: false,
    ...extra,
  } as Annotation;
}

function guideThread(id: string, text: string): Annotation {
  return thread(id, text, {
    anchor: { host: { kind: "block", blockId: "problem#b1" }, quotedText: "folded values" } as Annotation["anchor"],
  });
}

function snapshot(
  prefs: ReviewSnapshot["viewPrefs"],
  annotations: Annotation[] = [],
  extra: Record<string, unknown> = {},
): ReviewSnapshot {
  return {
    review: { id: "demo" },
    pages: [
      {
        id: "root",
        title: "Unfold obsolete folded response headers",
        cards: [{ id: "problem", title: "The problem", blocks: [{ id: "b1" }] }],
      },
    ],
    files: FILES,
    annotations,
    jobs: [],
    existingComments: [
      {
        id: 1,
        path: "src/app.py",
        line: 3,
        side: "RIGHT",
        body: "A made-up existing comment.",
        bodyHtml: "<p>A made-up existing comment.</p>",
        author: "teammate",
        htmlUrl: "https://example.invalid/comment/1",
      },
    ],
    viewPrefs: prefs,
    ...extra,
  } as unknown as ReviewSnapshot;
}

function renderMenu(snap: ReviewSnapshot): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot(snap);
  render(
    <MemoryRouter>
      <CommentsMenu reviewId="demo" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Comments/ }));
}

beforeEach(() => {
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("three disjoint sections", () => {
  const prefs = { showExistingComments: true, existingCommentsCollapsed: false } as ReviewSnapshot["viewPrefs"];
  const annotations = [
    thread("t-plain", "Plain review thought"),
    thread("t-outbox", "Outbox thought", { post: true }),
    thread("t-posted", "Posted thought", { post: true, postedAt: 123 }),
    thread("t-ai", "Suggested tweak", { messages: [{ who: "ai", text: "Suggested tweak", suggested: true }] }),
  ];

  it("This review holds unmarked and posted threads, the Outbox the marked unposted one", () => {
    renderMenu(snapshot(prefs, annotations));
    const review = screen.getByLabelText(/This review, 3 comments/);
    expect(review).toBeVisible();
    expect(screen.getByLabelText(/Outbox, 1 comment/)).toBeVisible();
    expect(screen.getByLabelText(/On GitHub, 1 thread/)).toBeVisible();
    // Posted threads return to This review; each thread appears once as
    // an entry (the export box also quotes the Outbox post text).
    expect(review).toHaveTextContent("Posted thought");
    for (const text of ["Plain review thought", "Posted thought"]) {
      expect(screen.getAllByText(text)).toHaveLength(1);
    }
    expect(screen.getAllByText("Outbox thought").filter((el) => el.closest("[data-cjump]"))).toHaveLength(1);
    // Entries under the file group show only their line, not the file again.
    expect(screen.getAllByText(":2")).not.toHaveLength(0);
    expect(review).not.toHaveTextContent("src/app.py:2");
  });

  it("AI-suggested threads carry their tag at a glance", () => {
    renderMenu(snapshot(prefs, annotations));
    expect(screen.getByText("AI-suggested")).toBeVisible();
  });

  it("guide threads group under Guide and the card, never the review title", () => {
    renderMenu(snapshot(prefs, [guideThread("t-guide", "Guide thought")]));
    const review = screen.getByLabelText(/This review, 1 comments/);
    expect(review).toHaveTextContent("Guide › The problem");
    expect(review).not.toHaveTextContent("Unfold obsolete folded response headers");
  });

  it("the Outbox section shows drafts and the export box with Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderMenu(snapshot(prefs, annotations));
    const box = screen.getByLabelText(/Outbox, 1 comment/);
    expect(box).toHaveTextContent("Nothing reaches GitHub until you use Submit review.");
    // The entry carries its editable draft; the export box quotes the post text.
    expect(box.querySelector("textarea")).not.toBeNull();
    expect(await screen.findByText(/Outbox thought/, { selector: "pre" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Outbox thought")));
  });

  it("an empty Outbox hides the export box", () => {
    renderMenu(snapshot(prefs, [thread("t-plain", "Plain review thought")]));
    expect(screen.getByText(/Nothing in the Outbox yet/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });
});

describe("On GitHub section", () => {
  it("hidden: heading carries the count; clicking shows the list and the setting", async () => {
    renderMenu(snapshot({ showExistingComments: false, existingCommentsCollapsed: false }));
    expect(screen.getByText("On GitHub")).toBeVisible();
    expect(screen.getByText("hidden")).toBeVisible();
    expect(screen.queryByText("A made-up existing comment.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /On GitHub/ }));
    await waitFor(() => expect(screen.getByText("A made-up existing comment.")).toBeVisible());
    expect(useReview.getState().snapshot?.viewPrefs.showExistingComments).toBe(true);
  });

  it("shown: the heading folds the section alone, remembered in the view settings", async () => {
    renderMenu(snapshot({ showExistingComments: true, existingCommentsCollapsed: false }));
    expect(screen.getByText("A made-up existing comment.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /On GitHub/ }));
    await waitFor(() => expect(screen.queryByText("A made-up existing comment.")).not.toBeInTheDocument());
    // Show/hide is untouched: only the menu section folded.
    expect(useReview.getState().snapshot?.viewPrefs).toEqual({
      showExistingComments: true,
      existingCommentsCollapsed: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /On GitHub/ }));
    await waitFor(() => expect(screen.getByText("A made-up existing comment.")).toBeVisible());
  });

  it("a document review shows no GitHub side", () => {
    renderMenu(
      snapshot({ showExistingComments: true, existingCommentsCollapsed: false }, [thread("t-doc", "Doc thought")], {
        document: { title: "Design note", blocks: [] },
      }),
    );
    expect(screen.queryByText("On GitHub")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing reaches GitHub/)).not.toBeInTheDocument();
  });
});
