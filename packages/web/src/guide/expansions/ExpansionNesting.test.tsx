/**
 * Selecting text inside an explanation (#116): annotations hosted on an
 * expansion block render under that block — open nested explanations as
 * cards, open threads in place, closed ones as footnote chips — and the
 * Ask/Note composer opens there too.
 */
import { afterEach, describe, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Annotation, Card, ReviewSnapshot } from "@unvibe/shared";
import { dedupeBlockIds, parseCards } from "@unvibe/shared";
import { NEW_THREAD_EVENT } from "../../floating/SelectionToolbar.js";
import { useReview } from "../../state/store.js";
import { CardView } from "../CardView.js";

const REVIEW_ID = "nesting-test";

function para(id: string, text: string): unknown {
  return { type: "paragraph", id, text: { standard: text }, citations: [] };
}

function expansion(
  id: string,
  hostBlockId: string,
  quote: string,
  blocks: unknown[],
  open = true,
): Annotation {
  return {
    id,
    type: "expansion",
    anchor: { host: { kind: "block", blockId: hostBlockId }, quotedText: quote, prefix: "", suffix: "", position: 0, version: 1 },
    open,
    messages: [],
    post: false,
    note: false,
    expansion: { blocks, level: "standard", read: false, collapsed: false, revision: 2, undoStack: [] },
  } as unknown as Annotation;
}

function thread(id: string, hostBlockId: string, quote: string): Annotation {
  return {
    id,
    type: "thread",
    anchor: { host: { kind: "block", blockId: hostBlockId }, quotedText: quote, prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    messages: [{ who: "you", text: "What does this mean?" }],
    post: false,
    note: false,
  } as unknown as Annotation;
}

function seed(card: Card, annotations: Annotation[]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards: [card] }],
    annotations,
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function card(): Card {
  return {
    id: "c1",
    pageId: "root",
    title: "Card",
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [para("b1", "Card block one with selectable text.")],
    undoStack: [],
  } as unknown as Card;
}

function show(c: Card): void {
  render(
    <div id="page">
      <CardView reviewId={REVIEW_ID} card={c} lookupPage={() => undefined} onOpenPage={() => {}} onFollowUp={() => {}} />
    </div>,
  );
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("annotations inside an expansion (#116)", () => {
  test("an open nested explanation renders under its expansion block", () => {
    const c = card();
    seed(c, [
      expansion("ann_parent", "c1#b1", "selectable", [para("b1", "Expansion block one with nested text.")]),
      expansion("ann_nested", "ann_parent#b1", "nested text", [para("b1", "Nested explanation body.")]),
    ]);
    show(c);
    expect(document.querySelector('[data-expansion="ann_parent"]')).not.toBeNull();
    const nested = document.querySelector('[data-expansion="ann_nested"]');
    expect(nested).not.toBeNull();
    expect(nested?.textContent).toMatch(/Nested explanation body/);
    // Nested under the parent block: inside the parent card.
    expect(document.querySelector('[data-expansion="ann_parent"] [data-expansion="ann_nested"]')).not.toBeNull();
  });

  test("a third level nests the same way (no depth limit)", () => {
    const c = card();
    seed(c, [
      expansion("ann_parent", "c1#b1", "selectable", [para("b1", "Level one.")]),
      expansion("ann_child", "ann_parent#b1", "Level one", [para("b1", "Level two.")]),
      expansion("ann_grand", "ann_child#b1", "Level two", [para("b1", "Level three body.")]),
    ]);
    show(c);
    const grand = document.querySelector('[data-expansion="ann_grand"]');
    expect(grand).not.toBeNull();
    expect(grand?.textContent).toMatch(/Level three body/);
  });

  test("an open thread on an expansion block renders under it", () => {
    const c = card();
    seed(c, [
      expansion("ann_parent", "c1#b1", "selectable", [para("b1", "Expansion block one.")]),
      thread("ann_thread", "ann_parent#b1", "block one"),
    ]);
    show(c);
    const view = document.getElementById("ann_thread");
    expect(view).not.toBeNull();
    expect(document.querySelector('[data-expansion="ann_parent"] #ann_thread')).not.toBeNull();
  });

  test("a closed nested explanation becomes a footnote chip on the expansion block", () => {
    const c = card();
    seed(c, [
      expansion("ann_parent", "c1#b1", "selectable", [para("b1", "Expansion block one.")]),
      expansion("ann_closed", "ann_parent#b1", "block one", [para("b1", "Closed body.")], false),
    ]);
    show(c);
    expect(document.querySelector('[data-expansion="ann_closed"]')).toBeNull();
    const chip = document.querySelector(
      '[data-expansion="ann_parent"] mark.fnote.exl[data-jump="ann_closed"]',
    );
    expect(chip).not.toBeNull();
  });

  test("the Ask composer opens under the expansion block", () => {
    const c = card();
    seed(c, [expansion("ann_parent", "c1#b1", "selectable", [para("b1", "Expansion block one.")])]);
    show(c);
    expect(screen.queryByLabelText("New comment")).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(NEW_THREAD_EVENT, {
          detail: { anchor: { where: "block", blockId: "ann_parent#b1" }, quote: "block one", note: false },
        }),
      );
    });
    const composer = screen.getByLabelText("New comment");
    expect(composer).not.toBeNull();
    expect(document.querySelector('[data-expansion="ann_parent"] [data-pending-thread]')).not.toBeNull();
  });
});

describe("one card per paragraph, from a real multi-card reply (#116)", () => {
  // The owner's defect: a two-card Explain reply flattened to ["b1","b1"],
  // so a nested anchor matched two blocks and drew its card twice. The
  // service now stores deduped IDs; each paragraph hosts exactly one card.
  const REPLY = `## First part

First paragraph about the folded header.

## Second part

Second paragraph about the folded header.

\`\`\`json
{}
\`\`\`
`;

  function parentFromReply(): { card: Card; parent: Annotation; paras: { id: string; quote: string }[] } {
    const body = dedupeBlockIds(parseCards(REPLY).flatMap((c) => c.blocks));
    const c = card();
    const parent = expansion("ann_parent", "c1#b1", "selectable", body);
    const paras = body
      .filter((b) => b.type === "paragraph")
      .map((b) => {
        const text = (b as { text: { standard: string } }).text.standard.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return { id: b.id, quote: text.split(" ").slice(0, 3).join(" ") };
      });
    return { card: c, parent, paras };
  }

  test("a nested explanation on each paragraph renders exactly once", () => {
    const { card: c, parent, paras } = parentFromReply();
    expect(paras.length).toBeGreaterThanOrEqual(2);
    const nested = paras.map(
      (p, i) =>
        expansion(`ann_nested_${i}`, `ann_parent#${p.id}`, p.quote, [para("b1", `Nested body ${i}.`)]) as Annotation,
    );
    seed(c, [parent, ...nested]);
    show(c);
    for (const n of nested) {
      const els = document.querySelectorAll(`[data-expansion="${n.id}"]`);
      expect(els).toHaveLength(1);
      // Under the parent card, inside the parent expansion.
      expect(document.querySelector(`[data-expansion="ann_parent"] [data-expansion="${n.id}"]`)).not.toBeNull();
    }
  });

  test("a thread and a note on expansion paragraphs render exactly once each", () => {
    const { card: c, parent, paras } = parentFromReply();
    const [first, second] = paras;
    const asker = thread("ann_ask", `ann_parent#${first.id}`, first.quote);
    const noter: Annotation = {
      ...thread("ann_note", `ann_parent#${second.id}`, second.quote),
      note: true,
    };
    seed(c, [parent, asker, noter]);
    show(c);
    expect(document.querySelectorAll("#ann_ask")).toHaveLength(1);
    expect(document.querySelectorAll("#ann_note")).toHaveLength(1);
    expect(document.querySelector('[data-expansion="ann_parent"] #ann_ask')).not.toBeNull();
    expect(document.querySelector('[data-expansion="ann_parent"] #ann_note')).not.toBeNull();
  });
});
