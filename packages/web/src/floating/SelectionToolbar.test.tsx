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
