/**
 * Real-Shiki tokenising tests (spike/shiki-highlighting, Refs #23).
 *
 * Happy-path goldens plus the documented wrong-colour cases of hunk-only
 * tokenising: a hunk is a fragment, so multi-line constructs opened before
 * the hunk colour wrong. These tests pin the behaviour (wrong but bounded)
 * so adoption can decide hunk-only vs full-file state.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Hunk, HunkLine } from "@unvibe/shared";
import { highlightHunk, resetHighlightForTests } from "./shiki.js";
import type { LineTokens } from "./tokenize.js";

afterEach(() => resetHighlightForTests());

function hunk(hash: string, lines: HunkLine[]): Hunk {
  return {
    contentHash: hash,
    header: "@@ -1 +1 @@",
    newStart: 1,
    newEnd: lines.length,
    oldStart: 1,
    oldEnd: lines.length,
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
    lines,
  };
}

const ctx = (text: string, n: number): HunkLine => ({ kind: "ctx", oldLine: n, newLine: n, text });
const add = (text: string, n: number): HunkLine => ({ kind: "add", newLine: n, text });
const del = (text: string, n: number): HunkLine => ({ kind: "del", oldLine: n, text });

function classes(rows: (LineTokens | null)[] | undefined): (string | null)[] | undefined {
  return rows?.map((r) => (r === null ? null : r.map((s) => s.cls ?? ".").join("")));
}

describe("highlightHunk with real Shiki", () => {
  it("highlights Python keywords, strings and comments", async () => {
    const h = hunk("py1", [
      add("def foo(x: str) -> str:", 10),
      add("    # a comment", 11),
      add('    return x + "hi"', 12),
    ]);
    const out = await highlightHunk(h, "src/a.py");
    expect(out).not.toBeNull();
    const rows = classes(out?.new);
    // `def` keyword, `#…` comment, `"hi"` string all carry classes.
    expect(rows?.[0]).toContain("shk-kw");
    expect(rows?.[1]).toContain("shk-com");
    expect(rows?.[2]).toContain("shk-str");
  });

  it("returns null for unknown languages (plain)", async () => {
    const h = hunk("rst1", [ctx("Some text", 1)]);
    expect(await highlightHunk(h, "changelog/1.bugfix.rst")).toBeNull();
    expect(await highlightHunk(h, "src/main.rs")).toBeNull();
  });

  it("documents the hunk-only wrong-colour case: string opened before the hunk", async () => {
    // Full file: `x = """` opens a triple-quoted string; the hunk only sees
    // the inside lines. Hunk-only tokenising colours them as code.
    const h = hunk("py-doc", [ctx("    inside the string", 5), add("    more string", 6)]);
    const out = await highlightHunk(h, "src/a.py");
    expect(out).not.toBeNull();
    // `inside` is NOT a string here (wrong, but bounded: no crash, no
    // uncoloured UI — just code colours inside a string fragment).
    expect(classes(out?.new)?.[0]).not.toContain("shk-str");
  });

  it("keeps old/new side state separate", async () => {
    // Old side opens a triple-quoted string the new side closes: the shared
    // context line after the change colours differently per side.
    const h = hunk("py-diverge", [
      del('x = """start', 4),
      add("x = 1", 4),
      ctx("tail()", 5),
    ]);
    const out = await highlightHunk(h, "src/a.py");
    expect(out).not.toBeNull();
    // Index 2 is the shared `ctx` row (index 0/1 are the del/add rows,
    // null on the opposite side).
    const oldTail = classes(out?.old)?.[2];
    const newTail = classes(out?.new)?.[2];
    // Old side is inside a string (string-coloured tail), new side is code.
    expect(oldTail).toContain("shk-str");
    expect(newTail).not.toContain("shk-str");
  });

  it("highlights JSON keys vs strings and shell comments", async () => {
    const j = hunk("json1", [add('"name": "unvibe",', 3)]);
    const jout = await highlightHunk(j, "pkg.json");
    expect(jout).not.toBeNull();
    expect(classes(jout?.new)?.[0]).toContain("shk-");

    const s = hunk("sh1", [add("# comment", 1), add("echo hi", 2)]);
    const sout = await highlightHunk(s, "run.sh");
    expect(classes(sout?.new)?.[0]).toContain("shk-com");
  });
});
