import { describe, expect, test } from "vitest";
import { resolveSelectionHost } from "./SelectionToolbar.js";

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
