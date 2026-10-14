/**
 * Fixed fixture snapshot for prompt/context golden tests: a tiny slice of
 * urllib3#5020 ("Unfold obsolete folded response header values").
 * Deliberately small; a full-snapshot test can reuse these builders after
 * the ingest agent lands its fixtures.
 */
import type { LogEntry } from "@unvibe/shared";
import type { PromptReviewSnapshot } from "../src/context/index.js";

export const HEAD_SHA = "abc1234def5678abc1234def5678abc1234def5";

function log(seq: number, kind: string, payload: unknown, scope: LogEntry["scope"]): LogEntry {
  return { seq, kind, payload, scope };
}

export function fixtureSnapshot(): PromptReviewSnapshot {
  return {
    reviewId: "r-5020",
    title: "Unfold obsolete folded response header values",
    repo: "urllib3/urllib3",
    branch: "unfold-obs-fold",
    prNumber: 5020,
    version: 1,
    headSha: HEAD_SHA,
    baseRef: "main",
    guideRevision: "g1",
    model: "main-model",
    sourceKind: "pr",
    description: "Unfold obsolete folded response header values.\n\nHTTPHeaderDict and the original message are both normalized.",
    files: [
      {
        fileKey: "conn",
        path: "src/urllib3/connection.py",
        category: "source",
        hunks: [
          {
            contentHash: "h111",
            fileKey: "conn",
            header: "@@ -640,7 +650,7 @@ def getresponse(self):",
            context: "getresponse",
            newStart: 650,
            oldStart: 640,
            citedByGuide: true,
            summary: "getresponse builds HTTPHeaderDict from the normalized header list.",
            lines: [
              { kind: "ctx", text: "msg = response.msg" },
              { kind: "del", text: "headers = HTTPHeaderDict(msg.items())" },
              { kind: "add", text: "headers = HTTPHeaderDict(_normalize_header_values(msg))" },
              { kind: "ctx", text: "return headers" },
            ],
          },
          {
            contentHash: "h222",
            fileKey: "conn",
            header: "@@ -1,4 +1,5 @@",
            newStart: 1,
            oldStart: 1,
            hiddenReason: "import-only change",
            summary: "Imports the two new helpers.",
            lines: [
              { kind: "add", text: "from .util import _normalize_header_values" },
              { kind: "ctx", text: "import http.client" },
            ],
          },
        ],
      },
      {
        fileKey: "tconn",
        path: "test/test_connection.py",
        category: "tests",
        hunks: [
          {
            contentHash: "h333",
            fileKey: "tconn",
            header: "@@ -200,6 +210,10 @@ def test_fold(self):",
            context: "test_fold",
            newStart: 210,
            oldStart: 200,
            lines: [
              { kind: "ctx", text: "value = b'before \\t\\r\\n\\t  after'" },
              { kind: "add", text: "assert unfold(value) == b'before after'" },
              { kind: "add", text: "assert unfold(b'one\\r\\n two') == b'one two'" },
            ],
          },
        ],
      },
    ],
    pinnedCode: [
      {
        path: "src/urllib3/connection.py",
        start: 91,
        end: 110,
        sha: HEAD_SHA,
        language: "python",
        text: "def _normalize_header_value(value: bytes) -> bytes:\n    if b'\\r\\n' not in value:\n        return value\n    return _OBSOLETE_FOLD_RE.sub(b' ', value)",
      },
    ],
    cards: [
      {
        id: "c-problem",
        title: "The problem",
        level: "standard",
        revision: 1,
        markdown:
          "Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]",
      },
      {
        id: "c-central",
        title: "The central change",
        level: "standard",
        revision: 2,
        markdown:
          "urllib3 now unfolds header values after parsing. [[diff:conn:650-651]]",
      },
    ],
    findings: [
      {
        pageId: "f-lf",
        title: "Folds that end in a bare LF are not unfolded",
        confidence: "medium",
        summary: "http.client accepts bare-LF lines, but the pattern needs CRLF.",
        markdown: `The fast path needs CRLF. [[code:src/urllib3/connection.py:91-110@${HEAD_SHA}]]`,
      },
      {
        pageId: "f-perf",
        title: "The linear-time claim has no test",
        confidence: "high",
        summary: "Nothing would catch a backtracking regression.",
        markdown: "No long-input test exists. [[diff:tconn:210-212]]",
      },
    ],
    concepts: [
      { slug: "obs-fold", title: "Obsolete line folding", oneLine: "A header value continued on the next line." },
      { slug: "injection", title: "Header injection", oneLine: "A raw line break splitting one header into two." },
    ],
    existingComments: [],
    log: [
      log(1, "thread-summary", { summary: "Reader settled the cookie question" }, { scope: "global" }),
      log(2, "example", { text: "folded Set-Cookie example" }, { scope: "card", cardId: "c-problem" }),
      log(3, "diagram", { text: "flow diagram for another card" }, { scope: "card", cardId: "c-central" }),
      log(4, "contribution", { items: [{ kind: "fact", text: "Requests reads the original message" }] }, { scope: "global" }),
      log(5, "new-finding", { summary: "bare-LF finding published", hunkHash: "h111" }, { scope: "global" }),
      log(6, "deletion", { summary: "removed stale go-deeper draft" }, { scope: "global" }),
    ],
  };
}
