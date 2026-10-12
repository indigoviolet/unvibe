/** `escapeHtml` (issue #101): text in, HTML-safe text out. */
import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escapeHtml.js";

describe("escapeHtml", () => {
  it("escapes markup without touching plain text", () => {
    expect(escapeHtml("a = b")).toBe("a = b");
    expect(escapeHtml("<b>a & b</b>")).toBe("&lt;b&gt;a &amp; b&lt;/b&gt;");
  });
});
