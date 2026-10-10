import { describe, expect, test } from "vitest";
import { splitDescriptionHtml } from "./segments.js";

const HTML = `<div class="desc"><h3>The normalization</h3>` +
  `<p class="para" id="d-p1">First <code>x</code> paragraph.</p>` +
  `<ul class="para" id="d-p2"><li>one</li><li>two</li></ul></div>`;

describe("splitDescriptionHtml", () => {
  test("keeps paragraph ids so citations still resolve", () => {
    const segments = splitDescriptionHtml(HTML);
    expect(segments.map((s) => [s.tag, s.id])).toEqual([
      ["h3", null],
      ["p", "d-p1"],
      ["ul", "d-p2"],
    ]);
    expect(segments[1].html).toContain('id="d-p1"');
  });

  test("empty html has no segments", () => {
    expect(splitDescriptionHtml("")).toEqual([]);
  });
});
