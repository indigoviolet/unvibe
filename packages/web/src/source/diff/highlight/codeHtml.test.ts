/** `codeHtml` (issue #101): token runs to HTML, plain runs spanless. */
import { describe, expect, it } from "vitest";
import { codeLineHtml, segClass } from "./codeHtml.js";

describe("codeLineHtml", () => {
  it("escapes plain text with no spans", () => {
    expect(codeLineHtml("a < b & c", null)).toBe("a &lt; b &amp; c");
  });

  it("keeps plain runs spanless and colours the rest", () => {
    const html = codeLineHtml("const x = 1", [
      { text: "const", cls: "shk-kw", bold: false, italic: false },
      { text: " x = 1", cls: null, bold: false, italic: false },
    ]);
    expect(html).toBe('<span class="shk-kw">const</span> x = 1');
  });

  it("combines bold/italic flags like the React spans did", () => {
    expect(segClass("shk-kw", true, true)).toBe("shk-kw shk-b shk-i");
    expect(segClass(null, false, false)).toBe("");
    const html = codeLineHtml("<x>", [{ text: "<x>", cls: "shk-fn", bold: true, italic: false }]);
    expect(html).toBe('<span class="shk-fn shk-b">&lt;x&gt;</span>');
  });
});
