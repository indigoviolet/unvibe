import { describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import {
  blockquoteQuote,
  commentCardAnchor,
  diffRangeForSelection,
  githubHrefForRange,
  inSelectionScope,
  isRevealedElement,
  resolveSelectionHost,
  selectionScopeElement,
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

describe("selections inside a floating card (#186)", () => {
  test("a floating card in the diff resolves its answer block and is in scope", () => {
    // The diff floating layer: at the hunk level, outside the table.
    document.body.innerHTML =
      `<div id="right"><div class="dhunk"><div class="dhunk-float"><div class="exp-float">` +
      `<section class="card child floating" id="B-ann_p"><div data-answer="ans_1">` +
      `<p class="prose sel" data-top="b9"><span id="in-float">answer text</span></p>` +
      `</div></section></div></div></div></div>`;
    const el = document.getElementById("in-float")!;
    expect(resolveSelectionHost(el)).toEqual({ anchor: { where: "block", blockId: "ans_1#b9" } });
    expect(inSelectionScope(el)).toBe(true);
  });

  test("a floating card in the guide is in scope", () => {
    document.body.innerHTML =
      `<div id="page"><section class="card" id="C-c1">` +
      `<div class="exp-float"><section class="card child floating" id="B-ann_g"><div data-answer="ans_2">` +
      `<p class="prose sel" data-top="b3"><span id="in-guide-float">text</span></p>` +
      `</div></section></div></section></div>`;
    const el = document.getElementById("in-guide-float")!;
    expect(resolveSelectionHost(el)).toEqual({ anchor: { where: "block", blockId: "ans_2#b3" } });
    expect(inSelectionScope(el)).toBe(true);
  });

  test("plain page chrome is out of scope", () => {
    document.body.innerHTML = `<div><span id="chrome">text</span></div>`;
    expect(inSelectionScope(document.getElementById("chrome")!)).toBe(false);
  });
});

describe("selectionScopeElement (issue #166)", () => {
  test("guide blocks scope to their [data-top] element", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1"><p class="prose sel" data-top="b1">the <span id="in">fast path</span> wins</p>` +
      `</section></div>`;
    const scope = selectionScopeElement(document.getElementById("in")!);
    expect(scope?.getAttribute("data-top")).toBe("b1");
  });

  test("answer blocks scope to their own [data-top], not the card", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1"><p data-top="b1">card</p>` +
      `<section class="card child" id="B-ann_1"><div data-answer="ans_1">` +
      `<p class="prose sel" data-top="b9"><span id="in-ans">answer text</span></p>` +
      `</div></section></section></div>`;
    const scope = selectionScopeElement(document.getElementById("in-ans")!);
    expect(scope?.getAttribute("data-top")).toBe("b9");
  });

  test("description selections scope to the paragraph body", () => {
    document.body.innerHTML =
      `<div id="right"><div class="desc">` +
      `<div data-top="p1" id="p1"><div class="dseg-body"><span id="in-desc">body text</span></div></div>` +
      `</div></div>`;
    const scope = selectionScopeElement(document.getElementById("in-desc")!);
    expect(scope?.classList.contains("dseg-body")).toBe(true);
  });

  test("diff selections scope to their code cell", () => {
    document.body.innerHTML =
      `<div id="right"><table class="diff"><tbody><tr id="L-conn-77">` +
      `<td class="n">77</td><td class="n new">77</td>` +
      `<td class="c"><span><span id="in-cell">code text</span></span></td>` +
      `</tr></tbody></table></div>`;
    const scope = selectionScopeElement(document.getElementById("in-cell")!);
    expect(scope?.tagName).toBe("TD");
    expect(scope?.classList.contains("c")).toBe(true);
  });

  test("hunk summaries scope to the summary text", () => {
    document.body.innerHTML =
      `<div id="right"><div class="dhunk"><div class="fwrap"><div class="fcard">` +
      `<p data-hunksum="conn:hash"><span id="in-sum">summary text</span></p>` +
      `</div></div></div></div>`;
    const scope = selectionScopeElement(document.getElementById("in-sum")!);
    expect(scope?.getAttribute("data-hunksum")).toBe("conn:hash");
  });

  test("no scope inside second-opinion reasoning", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card" id="C-c1">` +
      `<section class="so" data-so="x"><span id="in-so">reasoning</span></section>` +
      `</section></div>`;
    expect(selectionScopeElement(document.getElementById("in-so")!)).toBeNull();
  });
});

describe("resolveSelectionHost inside AI-suggested comments (issue #163)", () => {
  function seedSuggested(): void {
    useReview.getState().clear();
    useReview.getState().setSnapshot({
      review: { id: "r", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
      version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
      files: [],
      pages: [],
      annotations: [
        {
          id: "ann_sug",
          type: "comment",
          anchor: {
            host: { kind: "diff-line", fileKey: "conn", line: 82 },
            quotedText: "_OBSOLETE_FOLD_RE",
            prefix: "",
            suffix: "",
            position: 82,
            version: 1,
          },
          open: true,
          pinned: false,
          messages: [{ who: "ai", text: "Consider a boundary test.", suggested: true }],
          post: false,
        },
      ],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    } as unknown as ReviewSnapshot);
  }

  test("a selection in the suggestion anchors to the comment", () => {
    seedSuggested();
    document.body.innerHTML =
      `<div id="right"><table class="diff"><tbody>` +
      `<tr id="L-conn-82"><td class="n">82</td><td class="c"><span>code</span></td></tr>` +
      `<tr class="pr"><td colspan="3"><div class="pin"><div class="ithread" id="ann_sug">` +
      `<div class="msg" data-ai-comment="ann_sug"><div><p><span id="in-sug">boundary test</span></p></div></div>` +
      `</div></div></td></tr></tbody></table></div>`;
    try {
      expect(resolveSelectionHost(document.getElementById("in-sug")!)).toEqual({
        anchor: { where: "diff-line", fileKey: "conn", line: 82 },
      });
      const scope = selectionScopeElement(document.getElementById("in-sug")!);
      expect(scope?.getAttribute("data-ai-comment")).toBe("ann_sug");
    } finally {
      useReview.getState().clear();
    }
  });

  test("an unknown suggestion id resolves to nothing", () => {
    seedSuggested();
    document.body.innerHTML =
      `<div id="right"><div class="msg" data-ai-comment="ann_gone"><span id="in-gone">x</span></div></div>`;
    try {
      expect(resolveSelectionHost(document.getElementById("in-gone")!)).toBeNull();
    } finally {
      useReview.getState().clear();
    }
  });
});

function seedConversationCard(): void {
  const card: Annotation = {
    id: "ann_1",
    type: "conversation",
    turns: [{ id: "ans_9", question: null, blocks: [], level: "standard", revision: 1, undoStack: [] }],
    anchor: {
      host: { kind: "diff-line", fileKey: "conn", line: 91 },
      quotedText: "code",
      prefix: "",
      suffix: "",
      position: 91,
      version: 1,
    },
    open: true,
    pinned: false,
    messages: [],
    post: false,
  };
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: "r", repoId: "x", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [card],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

describe("selection inside a conversation answer (issue #136)", () => {
  test("the owning answer comes from the answer wrapper, not the card section", () => {
    document.body.innerHTML =
      `<div id="page">` +
      `<section class="card child" id="B-ann_1">` +
      `<div class="ans" data-answer="ans_9"><p data-top="b1"><span id="in-answer">x</span></p></div>` +
      `</section></div>`;
    expect(resolveSelectionHost(document.getElementById("in-answer")!)).toEqual({
      anchor: { where: "block", blockId: "ans_9#b1" },
    });
  });

  test("an answer owner maps a comment to the card anchor", () => {
    seedConversationCard();
    expect(commentCardAnchor({ where: "block", blockId: "ans_9#b1" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 91,
    });
  });
});

describe("comment from an agent answer (issue #135)", () => {
  test("a block anchor inside an answer maps to the card anchor", () => {
    seedConversationCard();
    expect(commentCardAnchor({ where: "block", blockId: "ans_9#b2" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 91,
    });
  });

  test("a page-card anchor maps nowhere", () => {
    seedConversationCard();
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

describe("resolveSelectionHost on idle hunk summaries (issue #138)", () => {
  test("a selection in the summary anchors the hunk", () => {
    document.body.innerHTML =
      `<div id="right"><div class="dhunk"><div class="fwrap"><div class="fcard">` +
      `<div class="fsum"><p data-hunksum="conn:hash1"><span id="in-sum">Unfolds folds</span></p></div>` +
      `</div></div></div></div>`;
    expect(resolveSelectionHost(document.getElementById("in-sum")!)).toEqual({
      anchor: { where: "hunk", fileKey: "conn", contentHash: "hash1" },
    });
  });

  test("a selection inside an activated hunk card still addresses its answer blocks", () => {
    document.body.innerHTML =
      `<div id="right"><div class="dhunk"><div class="fwrap"><div class="fcard">` +
      `<section class="card child" data-expansion="ann_h"><div class="ans" data-answer="ans_1">` +
      `<div class="exp-b"><p class="prose sel" data-top="b1"><span id="in-ans">Unfolds folds</span></p></div>` +
      `</div></section></div></div></div></div>`;
    expect(resolveSelectionHost(document.getElementById("in-ans")!)).toEqual({
      anchor: { where: "block", blockId: "ans_1#b1" },
    });
  });
});

describe("resolveSelectionHost inside read-only GitHub threads (issue #168)", () => {
  test("a selection in the thread body anchors the thread's diff line", () => {
    document.body.innerHTML =
      `<div id="right"><table class="diff"><tbody><tr class="pr"><td colspan="3">` +
      `<div class="pin"><div class="ithread gh" data-gh-thread="conn:82">` +
      `<div class="msg"><div><div class="ghbody"><p><span id="in-gh">bare LF</span> here too</p></div></div></div>` +
      `</div></div></td></tr></tbody></table></div>`;
    expect(resolveSelectionHost(document.getElementById("in-gh")!)).toEqual({
      anchor: { where: "diff-line", fileKey: "conn", line: 82 },
    });
  });

  test("an outdated thread (no line target) offers no toolbar", () => {
    document.body.innerHTML =
      `<div id="right"><div class="ghfile"><div class="ithread gh">` +
      `<div class="msg"><div><div class="ghbody"><p><span id="in-gh-old">old remark</span></p></div></div></div>` +
      `</div></div></div>`;
    expect(resolveSelectionHost(document.getElementById("in-gh-old")!)).toBeNull();
  });
});
