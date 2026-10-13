/**
 * Citation resolution tests: real hunk-line previews, description
 * paragraphs, short-key aliases, and reveal canonicalization.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { canonicalRevealTarget, resolveCitation } from "./citations.js";

const CONN = "src-urllib3-connection.py";

function snapshot(): ReviewSnapshot {
  return {
    review: {
      id: "demo",
      repoId: "r",
      branch: "b",
      // The fixture models a PR review (urllib3-5020).
      prNumber: 5020,
      versions: [],
      currentVersion: 1,
      createdAt: 0,
    },
    version: { n: 1, headSha: "h", mergeBaseSha: "m", baseRef: "main", fetchedAt: 0, idMapping: {} },
    ingest: { status: "ready" },
    files: [
      {
        fileKey: CONN,
        path: "src/urllib3/connection.py",
        category: "source",
        hunks: [
          {
            contentHash: "abc",
            header: "@@ -80,10 +80,10 @@",
            newStart: 80,
            newEnd: 89,
            oldStart: 80,
            oldEnd: 89,
            added: 1,
            removed: 1,
            lines: [
              { kind: "ctx", oldLine: 80, newLine: 80, text: "# a comment" },
              { kind: "add", newLine: 81, text: "_OBSOLETE_FOLD_RE = re.compile()" },
              { kind: "ctx", oldLine: 82, newLine: 82, text: "x = 1" },
            ],
          },
        ],
      },
    ],
    description: {
      html: '<div class="desc"><p class="para" id="d-p1">Intro text here.</p></div>',
      rev: "1",
      source: "pr",
      editable: false,
    },
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
}

const ALIASES = { conn: CONN };

describe("resolveCitation", () => {
  it("previews real hunk lines for canonical diff targets", () => {
    const r = resolveCitation(snapshot(), { target: `diff:${CONN}:80-81` });
    expect(r.label).toBe("connection.py:80–81");
    expect(r.snippet).toContain("_OBSOLETE_FOLD_RE = re.compile()");
  });

  it("resolves short fixture keys through the alias map", () => {
    const r = resolveCitation(snapshot(), { target: "diff:conn:81" }, ALIASES);
    expect(r.label).toBe("connection.py:81");
    expect(r.snippet).toContain("_OBSOLETE_FOLD_RE");
  });

  it("leaves unknown keys with a bare label", () => {
    const r = resolveCitation(snapshot(), { target: "diff:nope:1" }, ALIASES);
    expect(r.label).toBe("diff:nope:1");
    expect(r.snippet).toBe("");
  });

  it("previews description paragraphs", () => {
    const r = resolveCitation(snapshot(), { target: "desc:d-p1" });
    expect(r.label).toBe("PR description");
    expect(r.snippet).toBe("Intro text here.");
  });

  it("labels description citations Commits on a branch review (finding 22)", () => {
    const snap = snapshot();
    (snap.review as { prNumber?: number }).prNumber = undefined;
    const r = resolveCitation(snap, { target: "desc:d-p1" });
    expect(r.label).toBe("Commits");
    expect(r.snippet).toBe("Intro text here.");
  });

  it("keeps the unverified flag", () => {
    const r = resolveCitation(snapshot(), { target: "diff:nope:1", unverified: true });
    expect(r.unverified).toBe(true);
  });

  it("labels a hunk citation by file and lines, never by hash (finding 13)", () => {
    const r = resolveCitation(snapshot(), { target: `h:${CONN}:abc` });
    expect(r.label).toBe("connection.py:80–89");
  });

  it("labels a hunk citation by file when the hunk is gone", () => {
    const r = resolveCitation(snapshot(), { target: `h:${CONN}:missing` });
    expect(r.label).toBe("connection.py");
  });

  it("leaves a hunk citation raw when the file is unknown", () => {
    const r = resolveCitation(snapshot(), { target: "h:nope:abc" });
    expect(r.label).toBe("h:nope:abc");
  });
});

describe("canonicalRevealTarget", () => {
  it("canonicalizes alias diff targets, passes the rest through", () => {
    const snap = snapshot();
    expect(canonicalRevealTarget(snap, "diff:conn:80-81", ALIASES)).toBe(
      `diff:${CONN}:80-81`,
    );
    expect(canonicalRevealTarget(snap, `diff:${CONN}:80`, ALIASES)).toBe(`diff:${CONN}:80`);
    expect(canonicalRevealTarget(snap, "desc:d-p1", ALIASES)).toBe("desc:d-p1");
    expect(canonicalRevealTarget(snap, "bogus", ALIASES)).toBe("bogus");
  });
});
