/**
 * Issue #110: the base context lists the PR description's paragraphs with
 * their `desc:` IDs, so agents cite the description without a tool call.
 *
 * The IDs must be exactly the ones the validator and the web resolve:
 * every surface reads them through the single source
 * (`parseDescriptionParagraphs`, issue #96). These tests drive
 * `toPromptSnapshot` + the source blurb and assert equality with the
 * validator lookup, plus the pending-edit and base-key rules.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { buildSourceBlurb, formatDescriptionParagraphs } from "../src/context/index.js";
import { parseDescriptionParagraphs, renderMarkdownBlocks } from "../src/ingest/description.js";
import { lookupForSnapshot } from "../src/pipeline/lookup.js";
import {
  descriptionRevisionForSnapshot,
  guideRevisionForSnapshot,
  toPromptSnapshot,
} from "../src/routes/prompts.js";

// Paragraph, heading, paragraph, multi-item list, paragraph: the heading
// and list must not shift the IDs (the #96 fault shape).
const BODY = [
  "Intro paragraph about the motivate alpha.",
  "",
  "## Background heading",
  "",
  "Second paragraph mentioning the prototype link beta.",
  "",
  "- list item one gamma",
  "- list item two delta",
  "",
  "Third paragraph after the list zeta.",
  "",
].join("\n");

function snapshotFor(html: string, extra?: Partial<ReviewSnapshot["description"]>): ReviewSnapshot {
  return {
    review: {
      id: "rv_desc110",
      repoId: "octo/hello",
      branch: "feature",
      prNumber: 7,
      versions: [],
      currentVersion: 1,
      createdAt: 1,
    },
    version: {
      n: 1,
      headSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      baseRef: "main",
      fetchedAt: 1,
      idMapping: {},
    },
    files: [],
    description: {
      html,
      rev: "1",
      source: "pr",
      editable: true,
      ...extra,
    },
    ingest: { status: "ready" },
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as ReviewSnapshot;
}

describe("issue #110: description paragraph IDs in the base context", () => {
  it("the base lists the IDs ingest assigned", () => {
    const rendered = renderMarkdownBlocks(BODY);
    const promptSnap = toPromptSnapshot(snapshotFor(rendered.html));
    // Same function, same output: the base carries parse results verbatim
    // (multi-line blocks read back space-joined; IDs are what matter).
    const parsed = parseDescriptionParagraphs(rendered.html);
    expect(promptSnap.descriptionParagraphs).toEqual(parsed);
    expect(parsed.map((p) => p.id)).toEqual(rendered.paragraphs.map((p) => p.id));
    const blurb = buildSourceBlurb(promptSnap);
    for (const p of parsed) {
      expect(blurb).toContain(`- desc:${p.id}: ${p.text}`);
    }
    // Headings carry no ID and stay out of the listing.
    expect(blurb).not.toContain("Background heading");
  });

  it("base IDs are exactly the ones the validator resolves", () => {
    const rendered = renderMarkdownBlocks(BODY);
    const snapshot = snapshotFor(rendered.html);
    const promptSnap = toPromptSnapshot(snapshot);
    const lookup = lookupForSnapshot(snapshot);
    for (const p of promptSnap.descriptionParagraphs!) {
      // The validator resolves the base-listed ID back to the listed text.
      expect(lookup.descParagraph(p.id)).toBe(p.text);
    }
  });

  it("the base reads the pending edit, keeping IDs stable", () => {
    const rendered = renderMarkdownBlocks(BODY);
    const id = rendered.paragraphs.find((p) => p.text.includes("after the list"))!.id;
    const editedHtml = rendered.html.replace("after the list zeta", "after the list ZETA-EDITED");
    const promptSnap = toPromptSnapshot(snapshotFor(rendered.html, { pendingHtml: editedHtml }));
    const edited = promptSnap.descriptionParagraphs!.find((p) => p.id === id)!;
    expect(edited.text).toContain("ZETA-EDITED");
    expect(buildSourceBlurb(promptSnap)).toContain(`- desc:${id}: ${edited.text}`);
    // The validator sees the same edited text under the same ID.
    expect(lookupForSnapshot(snapshotFor(rendered.html, { pendingHtml: editedHtml })).descParagraph(id)).toContain(
      "ZETA-EDITED",
    );
  });

  it("ID-less stored HTML falls back to plain Markdown", () => {
    const html = `<div class="desc"><p>No IDs here.</p></div>`;
    const promptSnap = toPromptSnapshot(snapshotFor(html));
    expect(promptSnap.descriptionParagraphs).toBeUndefined();
    expect(buildSourceBlurb(promptSnap)).toContain("No IDs here.");
    expect(buildSourceBlurb(promptSnap)).not.toContain("- desc:");
  });

  it("a description edit changes the base key; anything else does not", () => {
    const rendered = renderMarkdownBlocks(BODY);
    const before = snapshotFor(rendered.html);
    const editedHtml = rendered.html.replace("motivate alpha", "motivate ALPHA-EDITED");
    const edited = snapshotFor(rendered.html, { pendingHtml: editedHtml });
    expect(descriptionRevisionForSnapshot(edited)).not.toBe(descriptionRevisionForSnapshot(before));
    expect(guideRevisionForSnapshot(edited)).not.toBe(guideRevisionForSnapshot(before));
    // Clearing the edit restores the key.
    expect(guideRevisionForSnapshot(snapshotFor(rendered.html))).toBe(guideRevisionForSnapshot(before));
    // Log growth and job updates (snapshot rev) never move the key.
    const grown = snapshotFor(rendered.html);
    grown.logTail.push({ seq: 1, kind: "thread-summary", payload: { summary: "x" }, scope: { scope: "global" } });
    grown.rev = 99;
    expect(guideRevisionForSnapshot(grown)).toBe(guideRevisionForSnapshot(before));
  });

  it("branch commit logs render unchanged", () => {
    const promptSnap = toPromptSnapshot({ ...snapshotFor("<div></div>"), description: undefined });
    expect(promptSnap.descriptionParagraphs).toBeUndefined();
    expect(buildSourceBlurb({ ...promptSnap, sourceKind: "branch" })).toContain("## Commit log");
  });

  it("formatDescriptionParagraphs renders one ID line per paragraph", () => {
    expect(formatDescriptionParagraphs([{ id: "d-p1", text: "Alpha." }])).toBe("- desc:d-p1: Alpha.");
  });
});
