/**
 * M6 description round-trip (PRD 4.11, 15): content outside edited
 * paragraphs round-trips byte-for-byte against the original PR body —
 * tables, code fences, lists, HTML comments, CRLF, trailing whitespace.
 */
import { describe, expect, it } from "vitest";
import { FakeCommandRunner } from "../src/exec/index.js";
import { renderMarkdownBlocks } from "../src/ingest/description.js";
import {
  buildParagraphSources,
  editedHtmlToMarkdown,
  isDescriptionChanged,
  parseDescBlocks,
  splitRawBlocks,
} from "../src/submit/description.js";
import { OWNER, PR_NUMBER, REPO_NAME, setupReview } from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };

const TRICKY =
  "## Title with trailing space \n" +
  "\n" +
  "First paragraph with trailing whitespace. \n" +
  "Second line of the same para.\n" +
  "\n" +
  "| a | b |\n" +
  "|---|---|\n" +
  "| 1 | 2 |\n" +
  "\n" +
  "```python\n" +
  "def f():\n" +
  "    return 1\n" +
  "```\n" +
  "\n" +
  "- item one\n" +
  "- item two\n" +
  "\n" +
  "<!-- a html comment -->\n" +
  "\n" +
  "Last paragraph.\n";

const CRLF = "Para one.\r\n\r\n```\r\ncode\r\n```\r\n\r\nPara two with trailing space. \r\n";

describe("description round-trip", () => {
  it("assigns stable ids matching the renderer", () => {
    const rendered = renderMarkdownBlocks(TRICKY);
    const parsed = parseDescBlocks(rendered.html);
    // Heading first (no id), then six paragraphs.
    expect(parsed[0].tag).toBe("h3");
    expect(parsed[0].id).toBeNull();
    expect(parsed.slice(1).map((b) => b.id)).toEqual(["d-p1", "d-p2", "d-p3", "d-p4", "d-p5", "d-p6"]);
    const raw = splitRawBlocks(TRICKY);
    expect(raw.filter((b) => b.id).map((b) => b.id)).toEqual(["d-p1", "d-p2", "d-p3", "d-p4", "d-p5", "d-p6"]);
  });

  it("edits one paragraph; everything else byte-identical", () => {
    const rendered = renderMarkdownBlocks(TRICKY);
    const raw = splitRawBlocks(TRICKY);
    for (const block of raw.filter((b) => b.id)) {
      const edited = rendered.html.replace(
        new RegExp(`(<[^>]*id="${block.id}"[^>]*>)([\\s\\S]*?)(<\\/(?:p|ul|ol|pre)>)`),
        (_m, open: string, _inner: string, close: string) => `${open}EDITED ${block.id}${close}`,
      );
      const md = editedHtmlToMarkdown(TRICKY, edited);
      // Every other raw slice survives verbatim.
      for (const other of raw) {
        if (other.id === block.id) continue;
        expect(md.includes(other.raw), `block ${other.id ?? "heading"} preserved when editing ${block.id}`).toBe(true);
      }
      expect(md.includes(`EDITED ${block.id}`)).toBe(true);
    }
    // Editing the first para preserves the tricky blocks verbatim.
    const firstEdit = rendered.html.replace(
      /(<[^>]*id="d-p1"[^>]*>)([\s\S]*?)(<\/(?:p|ul|ol|pre)>)/,
      "$1EDITED$3",
    );
    const firstMd = editedHtmlToMarkdown(TRICKY, firstEdit);
    expect(firstMd.includes("| 1 | 2 |")).toBe(true);
    expect(firstMd.includes("<!-- a html comment -->")).toBe(true);
    expect(firstMd.includes("```python")).toBe(true);
    expect(firstMd.includes("- item one")).toBe(true);
  });

  it("preserves CRLF + trailing whitespace outside the edit", () => {
    const rendered = renderMarkdownBlocks(CRLF);
    const firstId = parseDescBlocks(rendered.html)[0].id;
    expect(firstId).toBeTruthy();
    const edited = rendered.html.replace(/(<p[^>]*>)([\s\S]*?)(<\/p>)/, "$1EDITED$3");
    const md = editedHtmlToMarkdown(CRLF, edited);
    expect(md.includes("EDITED")).toBe(true);
    // Unchanged code fence + trailing-space para keep CRLF verbatim.
    expect(md.includes("```\r\ncode\r\n```")).toBe(true);
    expect(md.includes("Para two with trailing space. \r\n")).toBe(true);
  });

  it("detects changes", () => {
    const { html } = buildParagraphSources("A.\n\nB.\n");
    expect(isDescriptionChanged(html, html)).toBe(false);
    expect(isDescriptionChanged(html, html.replace("A.", "Z."))).toBe(true);
  });

  it("PUT stores pending HTML+Markdown only for the author on an open PR", async () => {
    const runner = new FakeCommandRunner();
    const base = "Alpha.\n\nBeta.\n";
    const { app, ctx, reviewId } = await setupReview(runner, { baseMarkdown: base });
    const snap = ctx.reviews.getSnapshot(reviewId);
    const edited = (snap?.description?.html ?? "").replace("Alpha.", "Alpha edited.");
    runner.enqueue({
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "author,state,body"],
      stdout: JSON.stringify({ author: { login: "me" }, state: "OPEN", body: base }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", "user"],
      stdout: JSON.stringify({ login: "me" }),
      stderr: "",
      code: 0,
    });
    try {
      const res = await app.inject({
        method: "PUT",
        url: `/api/reviews/${reviewId}/description`,
        headers: authed,
        payload: { html: edited },
      });
      expect(res.statusCode).toBe(200);
      const after = ctx.reviews.getSnapshot(reviewId);
      expect(after?.description?.pendingHtml).toContain("Alpha edited.");
      expect(after?.description?.pendingMarkdown).toContain("Alpha edited.");
      expect(after?.description?.pendingMarkdown).toContain("Beta.");
      // Exact gh invocations.
      expect(runner.calls.map((c) => c.opts.args)).toEqual([
        ["pr", "view", String(PR_NUMBER), "--json", "author,state,body"],
        ["api", "user"],
      ]);

      const reverted = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${reviewId}/description`,
        headers: authed,
      });
      expect(reverted.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(reviewId)?.description?.pendingHtml).toBeUndefined();
    } finally {
      await app.close();
    }
    void OWNER;
    void REPO_NAME;
  });

  it("PUT refuses non-authors, merged PRs, and branch reviews", async () => {
    const runner = new FakeCommandRunner();
    const { app, reviewId } = await setupReview(runner, { baseMarkdown: "A.\n\nB.\n" });
    try {
      // Non-author.
      runner.enqueue({
        cmd: "gh",
        args: ["pr", "view", String(PR_NUMBER), "--json", "author,state,body"],
        stdout: JSON.stringify({ author: { login: "alice" }, state: "OPEN", body: "A." }),
        stderr: "",
        code: 0,
      });
      runner.enqueue({
        cmd: "gh",
        args: ["api", "user"],
        stdout: JSON.stringify({ login: "mallory" }),
        stderr: "",
        code: 0,
      });
      const denied = await app.inject({
        method: "PUT",
        url: `/api/reviews/${reviewId}/description`,
        headers: authed,
        payload: { html: "<div class=\"desc\"></div>" },
      });
      expect(denied.statusCode).toBe(403);

      // Merged PR.
      runner.enqueue({
        cmd: "gh",
        args: ["pr", "view", String(PR_NUMBER), "--json", "author,state,body"],
        stdout: JSON.stringify({ author: { login: "me" }, state: "MERGED", body: "A." }),
        stderr: "",
        code: 0,
      });
      runner.enqueue({
        cmd: "gh",
        args: ["api", "user"],
        stdout: JSON.stringify({ login: "me" }),
        stderr: "",
        code: 0,
      });
      const merged = await app.inject({
        method: "PUT",
        url: `/api/reviews/${reviewId}/description`,
        headers: authed,
        payload: { html: "<div class=\"desc\"></div>" },
      });
      expect(merged.statusCode).toBe(403);
    } finally {
      await app.close();
    }

    const runner2 = new FakeCommandRunner();
    const branch = await setupReview(runner2, { prNumber: null, baseMarkdown: "A.\n" });
    try {
      const res = await branch.app.inject({
        method: "PUT",
        url: `/api/reviews/${branch.reviewId}/description`,
        headers: authed,
        payload: { html: "x" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await branch.app.close();
    }
  });
});
