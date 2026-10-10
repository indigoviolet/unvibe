/**
 * Unified-diff parser (ingest, PRD §11.1).
 *
 * Pure function: `git diff <merge-base> <head>` text in, files + hunks out.
 * Hunks are git's own (PRD §4.13): a run of changed lines plus up to 3
 * unchanged context lines. Row/line-range semantics intentionally match the
 * prototype (`prototype.html` per-file hunk loop): `newStart`/`oldStart` are
 * the `@@` starts, `newEnd`/`oldEnd` the last seen line numbers on each side,
 * `added`/`removed` count non-context rows, and `\ No newline` markers are
 * skipped (but recorded as `noNewline`).
 *
 * Handles: renames (`rename from/to`, `similarity`), new files
 * (`--- /dev/null`), deleted files (`+++ /dev/null`), binary files
 * (`Binary files … differ`), mode changes, and the
 * `\ No newline at end of file` marker.
 */

export interface ParsedHunkLine {
  kind: "add" | "del" | "ctx";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface ParsedHunk {
  header: string;
  /** Trailing `@@` context, e.g. `class Foo…` (raw; not parsed). */
  context?: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  added: number;
  removed: number;
  lines: ParsedHunkLine[];
  noNewline: boolean;
}

export interface ParsedFile {
  /** New-side path (post-rename). */
  path: string;
  /** Pre-rename path; present only for renames. */
  oldPath?: string;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
  hunks: ParsedHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

function stripGitPrefix(p: string): string {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

/**
 * Parse one `git diff` output into files. Never throws on unfamiliar
 * metadata lines: unknown `diff --git` preamble lines are skipped, and
 * unparseable hunks keep whatever rows decoded before the anomaly.
 */
export function parseUnifiedDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let cur: ParsedFile | null = null;
  // `diff --git` preamble accumulators for the file currently being opened.
  let preamble: {
    oldPath?: string;
    newPath?: string;
    renameFrom?: string;
    renameTo?: string;
    isNew?: boolean;
    isDeleted?: boolean;
    isBinary?: boolean;
  } = {};
  let hunk: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finishFile = (): void => {
    // A file section may carry no `+++`/hunks at all (binary pairs,
    // mode-only changes): flush a file from the preamble in that case.
    if (cur === null && (preamble.oldPath !== undefined || preamble.newPath !== undefined)) {
      cur = makeFileFromPreamble();
    }
    if (cur) files.push(cur);
    cur = null;
    hunk = null;
  };

  const makeFileFromPreamble = (): ParsedFile => {
    const p = preamble;
    preamble = {};
    const filePath = p.renameTo ?? p.newPath ?? p.renameFrom ?? p.oldPath ?? "unknown";
    const file: ParsedFile = {
      path: filePath,
      ...(p.renameFrom !== undefined ? { oldPath: p.renameFrom } : {}),
      isNew: p.isNew ?? false,
      isDeleted: p.isDeleted ?? false,
      isRename: p.renameFrom !== undefined,
      isBinary: p.isBinary ?? false,
      hunks: [],
    };
    cur = file;
    hunk = null;
    return file;
  };

  const split = diffText.split("\n");
  // Drop the split artifact after the final newline so it can't become a row.
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  for (const rawLine of split) {
    // A `diff --git` line always starts a new file section.
    if (rawLine.startsWith("diff --git ")) {
      finishFile();
      const m = rawLine.match(/^diff --git (\S+) (\S+)(?: |$)/);
      preamble = {
        oldPath: m ? stripGitPrefix(m[1]) : undefined,
        newPath: m ? stripGitPrefix(m[2]) : undefined,
      };
      continue;
    }

    if (rawLine.startsWith("Binary files ")) {
      preamble.isBinary = true;
      continue;
    }
    if (rawLine.startsWith("rename from ")) {
      preamble.renameFrom = rawLine.slice("rename from ".length);
      continue;
    }
    if (rawLine.startsWith("rename to ")) {
      preamble.renameTo = rawLine.slice("rename to ".length);
      continue;
    }
    if (rawLine.startsWith("new file mode")) {
      preamble.isNew = true;
      continue;
    }
    if (rawLine.startsWith("deleted file mode")) {
      preamble.isDeleted = true;
      continue;
    }

    if (rawLine.startsWith("--- ")) {
      const rest = rawLine.slice(4).trim().split("\t")[0];
      if (rest === "/dev/null") {
        preamble.isNew = true;
      } else if (cur === null) {
        preamble.oldPath = stripGitPrefix(rest);
      }
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      // `+++` ends the preamble: the file's identity is now known.
      const rest = rawLine.slice(4).trim().split("\t")[0];
      if (rest === "/dev/null") {
        preamble.isDeleted = true;
      } else {
        preamble.newPath = stripGitPrefix(rest);
      }
      makeFileFromPreamble();
      continue;
    }

    const hm = rawLine.match(HUNK_RE);
    if (hm) {
      // Hunk before any `+++` line: be lenient and open from the preamble.
      const file = cur ?? makeFileFromPreamble();
      oldLine = Number(hm[1]);
      newLine = Number(hm[2]);
      hunk = {
        header: rawLine,
        ...(hm[3] ? { context: hm[3] } : {}),
        oldStart: oldLine,
        oldEnd: oldLine,
        newStart: newLine,
        newEnd: newLine,
        added: 0,
        removed: 0,
        lines: [],
        noNewline: false,
      };
      file.hunks.push(hunk);
      continue;
    }

    if (rawLine.startsWith("\\")) {
      // `\ No newline at end of file` (or similar markers).
      if (hunk && /no newline/i.test(rawLine)) hunk.noNewline = true;
      continue;
    }

    if (hunk === null || cur === null) continue;
    const marker = rawLine[0];
    const text = rawLine.slice(1);
    if (marker === "+") {
      hunk.lines.push({ kind: "add", newLine, text });
      hunk.newEnd = newLine;
      newLine += 1;
      hunk.added += 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", oldLine, text });
      hunk.oldEnd = oldLine;
      oldLine += 1;
      hunk.removed += 1;
    } else if (marker === " ") {
      hunk.lines.push({ kind: "ctx", oldLine, newLine, text });
      hunk.oldEnd = oldLine;
      hunk.newEnd = newLine;
      oldLine += 1;
      newLine += 1;
    } else if (rawLine === "") {
      // Bare empty line: git never emits these (empty context lines carry
      // a space marker), but stripped diffs contain them. The prototype
      // ignores them, so parity requires ignoring them too.
      continue;
    } else {
      // Unknown row marker (e.g. `--2.47` version trailers after the diff):
      // stop attributing rows to this hunk.
      hunk = null;
    }
  }
  finishFile();
  return files;
}
