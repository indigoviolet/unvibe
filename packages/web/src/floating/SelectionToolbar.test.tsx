import { describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import {
  blockquoteQuote,
  commentCardAnchor,
  diffRangeForSelection,
  githubHrefForRange,
  isRevealedElement,
  resolveSelectionHost,
  type DiffRange,
} from "./SelectionToolbar.js";

describe("resolveSelectionHost (#78)", () => {
  test("guide blocks are addressed as card#block, expansions by their own id", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-problem"><p data-top="b2"><span id="in-card">x</span></p>` +
      `<section class="card child" id="B-ann_1"><p data-top="b2"><span id="in-exp">y</span></p></section>` +
      `</section></div>`;
    const host = (id: string) => resolveSelectionHost(document.getElementById(id)!);
    expect(host("in-card")).toEqual({ anchor: { where: "block", blockId: "problem#b2" } });
    expect(host("in-exp")).toEqual({ anchor: { where: "block", blockId: "ann_1#b2" } });
  });
});

describe("resolveSelectionHost inside other hosts (#116)", () => {
  test("a selection inside a nested expansion addresses the inner expansion", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1"><p data-top="b1"><span>card</span></p>` +
      `<section class="card child" id="B-ann_parent"><p data-top="b1"><span>parent</span></p>` +
      `<section class="card child" id="B-ann_child"><p data-top="b1"><span id="in-nested">nested</span></p></section>` +
      `</section></section></div>`;
    expect(resolveSelectionHost(document.getElementById("in-nested")!)).toEqual({
      anchor: { where: "block", blockId: "ann_child#b1" },
    });
  });

  test("no toolbar inside a second-opinion block (not an anchor host)", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1">` +
      `<section class="so" data-so="so-c1-blind-p-m"><div class="so-b">` +
      `<div class="blk" id="B-b9"><p class="prose sel" data-top="b9"><span id="in-so">reasoning</span></p></div>` +
      `</div></section></section></div>`;
    expect(resolveSelectionHost(document.getElementById("in-so")!)).toBeNull();
  });

  test("no toolbar inside a thread reply (threads are not hosts)", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1">` +
      `<div class="blk" id="B-b1"><p class="prose sel" data-top="b1"><span>card</span></p></div>` +
      `<div class="ithread" id="ann_t"><div class="msg"><div><p id="in-reply">reply</p></div></div></div>` +
      `</section></div>`;
    expect(resolveSelectionHost(document.getElementById("in-reply")!)).toBeNull();
  });

  test("a selection inside an aside addresses the aside block", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1">` +
      `<div class="blk gen-aside fresh" id="B-b2"><div class="tag">Example</div>` +
      `<p class="prose sel" data-top="b2"><span id="in-aside">inner</span></p></div>` +
      `</section></div>`;
    expect(resolveSelectionHost(document.getElementById("in-aside")!)).toEqual({
      anchor: { where: "block", blockId: "c1#b2" },
    });
  });
});

describe("comment from an agent answer (issue #135)", () => {
  function seedWithExpansion(): void {
    const expansion: Annotation = {
      id: "ann_1",
      type: "conversation",
      anchor: {
        host: { kind: "diff-line", fileKey: "conn", line: 91 },
        quotedText: "code",
        prefix: "",
        suffix: "",
        position: 91,
        version: 1,
      },
      open: true,
      messages: [],
      post: false,
      note: false,
    };
    useReview.getState().clear();
    useReview.getState().setSnapshot({
      review: { id: "r", repoId: "x", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
      version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
      files: [],
      pages: [],
      annotations: [expansion],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    } as unknown as ReviewSnapshot);
  }

  test("a block anchor inside an expansion maps to the card anchor", () => {
    seedWithExpansion();
    expect(commentCardAnchor({ where: "block", blockId: "ann_1#b2" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 91,
    });
  });

  test("a page-card anchor maps nowhere", () => {
    seedWithExpansion();
    expect(commentCardAnchor({ where: "block", blockId: "central#b2" })).toBeNull();
    expect(commentCardAnchor({ where: "diff-line", fileKey: "conn", line: 91 })).toBeNull();
  });

  test("the selection is quoted as a Markdown blockquote", () => {
    expect(blockquoteQuote("just one line")).toBe("> just one line\n\n");
    expect(blockquoteQuote("first\nsecond")).toBe("> first\n> second\n\n");
  });
});

describe("GitHub action range (issue #134)", () => {
  const HEAD = "bdcc1e493e";
  const BASE = "443cb01be1";

  function seedDiffTable(): void {
    document.body.innerHTML =
      `<div id="right"><div class="dfile" id="F-conn"><table class="diff"><tbody>` +
      `<tr class="add" id="L-conn-91"><td class="n">90</td><td class="n new">91</td><td class="c"><span>new line one</span></td></tr>` +
      `<tr class="add" id="L-conn-92"><td class="n"></td><td class="n new">92</td><td class="c"><span>new line two</span></td></tr>` +
      `<tr class="del"><td class="n">50</td><td class="n"></td><td class="c"><span>old line</span></td></tr>` +
      `</tbody></table></div></div>`;
  }

  function selectCellText(cellText: string): Selection {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const walker = document.createTreeWalker(document.querySelector("#right table.diff")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(cellText);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + cellText.length);
      sel.addRange(range);
      return sel;
    }
    throw new Error(`text ${cellText} not found`);
  }

  function snapshot(): ReviewSnapshot {
    return {
      files: [{ fileKey: "conn", path: "src/conn.py", category: "source", hunks: [] }],
      version: { n: 1, headSha: HEAD, mergeBaseSha: BASE, baseRef: "main", fetchedAt: 0, idMapping: {} },
    } as unknown as ReviewSnapshot;
  }

  test("added lines link the head commit with new-side numbers", () => {
    seedDiffTable();
    const range = diffRangeForSelection(selectCellText("new line one"));
    expect(range).toEqual({ fileKey: "conn", newLines: [91], oldLines: [] });
    const href = githubHrefForRange(snapshot(), { owner: "acme", name: "app" }, range as DiffRange);
    expect(href).toBe(`https://github.com/acme/app/blob/${HEAD}/src/conn.py#L91`);
  });

  test("removed-only selections link the base commit with old-side numbers", () => {
    seedDiffTable();
    const range = diffRangeForSelection(selectCellText("old line"));
    expect(range).toEqual({ fileKey: "conn", newLines: [], oldLines: [50] });
    const href = githubHrefForRange(snapshot(), { owner: "acme", name: "app" }, range as DiffRange);
    expect(href).toBe(`https://github.com/acme/app/blob/${BASE}/src/conn.py#L50`);
  });

  test("null when the repo, file or commit is unknown", () => {
    seedDiffTable();
    const range = diffRangeForSelection(selectCellText("new line one")) as DiffRange;
    expect(githubHrefForRange(snapshot(), null, range)).toBeNull();
    expect(githubHrefForRange({ ...snapshot(), files: [] }, { owner: "acme", name: "app" }, range)).toBeNull();
    expect(
      githubHrefForRange(
        { ...snapshot(), version: { ...snapshot().version, headSha: "" } },
        { owner: "acme", name: "app" },
        range,
      ),
    ).toBeNull();
  });
});

describe("revealed context (issue #133)", () => {
  function seedRevealedTable(): void {
    document.body.innerHTML =
      `<div id="right"><div class="dfile" id="F-conn"><table class="diff"><tbody>` +
      `<tr data-revealed="1" id="L-conn-70"><td class="n">70</td><td class="n">70</td><td class="c"><span>revealed context</span></td></tr>` +
      `</tbody></table></div>` +
      `<div class="dfile" id="F-gone"><table class="diff"><tbody>` +
      `<tr data-revealed="1"><td class="n">12</td><td class="n"></td><td class="c"><span>old context</span></td></tr>` +
      `</tbody></table></div></div>`;
  }

  function selectCellText(cellText: string): Selection {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const walker = document.createTreeWalker(document.querySelector("#right")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(cellText);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + cellText.length);
      sel.addRange(range);
      return sel;
    }
    throw new Error(`text ${cellText} not found`);
  }

  test("revealed rows flag the toolbar against Comment", () => {
    seedRevealedTable();
    const cell = document.querySelector("#right td.c") as HTMLElement;
    expect(isRevealedElement(cell)).toBe(true);
    expect(resolveSelectionHost(cell)).toEqual({
      anchor: { where: "diff-line", fileKey: "conn", line: 70 },
    });
  });

  test("hunk rows stay unflagged", () => {
    document.body.innerHTML =
      `<div id="right"><table class="diff"><tbody>` +
      `<tr class="ctx" id="L-conn-71"><td class="n">71</td><td class="n">71</td><td class="c"><span>hunk line</span></td></tr>` +
      `</tbody></table></div>`;
    expect(isRevealedElement(document.querySelector("#right td.c") as HTMLElement)).toBe(false);
  });

  test("revealed lines read as new-side lines for the GitHub link", () => {
    seedRevealedTable();
    expect(diffRangeForSelection(selectCellText("revealed context"))).toEqual({
      fileKey: "conn",
      newLines: [70],
      oldLines: [],
    });
  });

  test("revealed lines on a deleted file read as old-side lines", () => {
    seedRevealedTable();
    expect(diffRangeForSelection(selectCellText("old context"))).toEqual({
      fileKey: "gone",
      newLines: [],
      oldLines: [12],
    });
  });
});
