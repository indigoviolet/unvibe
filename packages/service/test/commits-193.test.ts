/**
 * Issue #193: commit evidence for plotlines — per-commit files/hunks at
 * ingest, and the compact Commits section in the reader's L1 context.
 * Pure logic only; the live reader behaviour is covered by the
 * `test:live:plotlines` script, not here.
 */
import { describe, expect, it } from "vitest";
import type { ReviewFile } from "@unvibe/shared";
import { buildReviewCommits } from "../src/ingest/commits.js";
import { parseUnifiedDiff } from "../src/ingest/diff.js";
import { buildL1Source } from "../src/context/index.js";
import { fixtureSnapshot } from "./fixtures.js";

function reviewFiles(): ReviewFile[] {
  return [
    {
      fileKey: "a",
      path: "src/a.py",
      category: "source",
      hunks: [
        {
          contentHash: "h1",
          header: "@@ -1,2 +1,3 @@",
          newStart: 10,
          newEnd: 12,
          oldStart: 10,
          oldEnd: 11,
          added: 1,
          removed: 0,
          lines: [
            { kind: "ctx", text: "x = 1" },
            { kind: "add", text: "return compute_value(x)" },
          ],
        },
        {
          contentHash: "h2",
          header: "@@ -20,2 +30,2 @@",
          newStart: 30,
          newEnd: 31,
          oldStart: 20,
          oldEnd: 21,
          added: 1,
          removed: 1,
          lines: [
            { kind: "del", text: "old_flag = False" },
            { kind: "add", text: "new_flag = True" },
          ],
        },
      ],
    },
  ];
}

const DIFF_SHIFTED = [
  "diff --git a/src/a.py b/src/a.py",
  "--- a/src/a.py",
  "+++ b/src/a.py",
  "@@ -1,2 +1,3 @@",
  " x = 1",
  "+return compute_value(x)",
  "",
].join("\n");

const DIFF_OTHER = [
  "diff --git a/src/a.py b/src/a.py",
  "--- a/src/a.py",
  "+++ b/src/a.py",
  "@@ -20,2 +20,2 @@",
  "-old_flag = False",
  "+new_flag = True",
  "",
].join("\n");

describe("buildReviewCommits (#193)", () => {
  it("maps a commit to PR hunks by shared changed lines despite line drift", () => {
    const out = buildReviewCommits(
      [{ sha: "aaa", subject: "Add compute", body: "why" }],
      new Map([["aaa", parseUnifiedDiff(DIFF_SHIFTED)]]),
      reviewFiles(),
    );
    expect(out).toEqual([
      { sha: "aaa", subject: "Add compute", body: "why", files: ["src/a.py"], hunks: ["h:a:h1"] },
    ]);
  });

  it("keeps an overwritten commit's files with no surviving hunks", () => {
    const out = buildReviewCommits(
      [
        { sha: "aaa", subject: "wip", body: "" },
        { sha: "bbb", subject: "Replace flag", body: "" },
      ],
      new Map([
        ["aaa", parseUnifiedDiff(DIFF_OTHER.replace("old_flag = False", "gone_flag = 1").replace("new_flag = True", "gone_flag = 2"))],
        ["bbb", parseUnifiedDiff(DIFF_OTHER)],
      ]),
      reviewFiles(),
    );
    expect(out[0].files).toEqual(["src/a.py"]);
    expect(out[0].hunks).toEqual([]);
    expect(out[1].hunks).toEqual(["h:a:h2"]);
  });

  it("keeps the message when no diff was fetched", () => {
    const out = buildReviewCommits([{ sha: "ccc", subject: "Merge main", body: "" }], new Map(), reviewFiles());
    expect(out).toEqual([{ sha: "ccc", subject: "Merge main", body: "", files: [], hunks: [] }]);
  });
});

describe("commits section (#193)", () => {
  it("renders subjects, bodies, files and hunk IDs in L1", () => {
    const text = buildL1Source(fixtureSnapshot()).text;
    expect(text).toContain("## Commits");
    expect(text).toContain("Unfold obsolete folded header values");
    expect(text).toContain("body: Normalize both views of the parsed headers.");
    expect(text).toContain("files: src/urllib3/connection.py");
    expect(text).toContain("hunks: h:conn:h111, h:conn:h222");
    expect(text).toContain("evidence for the plotlines, not the answer");
  });

  it("is absent when the snapshot carries no commits", () => {
    const snap = fixtureSnapshot();
    delete snap.commits;
    expect(buildL1Source(snap).text).not.toContain("## Commits");
  });
});
