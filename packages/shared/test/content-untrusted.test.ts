/**
 * Other people's Markdown (issue #168): paragraphs, lists and fences
 * render; raw HTML never passes through; images stay literal text;
 * links open in a new tab.
 */
import { describe, expect, it } from "vitest";
import { renderUntrustedMarkdown } from "../src/content/untrusted.js";

describe("renderUntrustedMarkdown", () => {
  it("renders paragraphs, lists and code spans", () => {
    const html = renderUntrustedMarkdown("Cover the fast path too.\n\n- one\n- two\n\nUse `x`.");
    expect(html).toContain("<p>Cover the fast path too.</p>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>x</code>");
  });

  it("escapes raw HTML instead of passing it through", () => {
    const html = renderUntrustedMarkdown('Nice <script>alert(1)</script> and <img src="x" onerror="y()">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders images as literal text and links in a new tab", () => {
    const html = renderUntrustedMarkdown("![alt](https://example.com/i.png) [docs](https://example.com/d)");
    expect(html).not.toContain("<img");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("neutralises javascript: links", () => {
    const html = renderUntrustedMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=\"javascript:");
  });
});
