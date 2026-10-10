/**
 * Pure diff pipeline shared by the service (ingest, PRD §11.1) and the web
 * mock fixture: unified-diff parsing, hunk content hashing, file
 * classification, file keys, uninteresting pre-classification, and
 * `ReviewFile` assembly.
 *
 * No Node or DOM APIs: the SHA-256 below is a self-contained synchronous
 * implementation (byte-identical to `node:crypto`'s `sha256`) so the same
 * code hashes hunks in Node and in the browser. Service `ingest/*.ts`
 * modules re-export from here; their tests keep passing unchanged.
 */
import type { FileCategory, Hunk, HunkLine, ReviewFile } from "./entities.js";

// --- parse shapes ----------------------------------------------------------

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
  lines: HunkLine[];
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

// --- unified-diff parser ---------------------------------------------------

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

function stripGitPrefix(p: string): string {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

/**
 * Parse one `git diff` output into files. Never throws on unfamiliar
 * metadata lines: unknown `diff --git` preamble lines are skipped, and
 * unparseable hunks keep whatever rows decoded before the anomaly.
 *
 * Hunks are git's own (PRD §4.13): `newStart`/`oldStart` are the `@@`
 * starts, `newEnd`/`oldEnd` the last seen line numbers on each side,
 * `added`/`removed` count non-context rows, and `\ No newline` markers are
 * skipped (but recorded as `noNewline`).
 *
 * Handles: renames, new/deleted files, binary files, mode changes.
 */
export function parseUnifiedDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let cur: ParsedFile | null = null;
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
      // a space marker), but stripped diffs contain them. Ignore them.
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

// --- SHA-256 (sync, no platform APIs) --------------------------------------
// Self-contained so hashing works identically in Node and browsers.
// Byte-identical output to `node:crypto` SHA-256 (covered by tests).

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 hex of a UTF-8 string. */
export function sha256HexUtf8(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const d = input.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
  );

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[off + i * 4] << 24) |
          (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) |
          bytes[off + i * 4 + 3]) |
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA_K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

// --- hunk content hash (PRD §8) --------------------------------------------

export const HUNK_HASH_LEN = 16;

/** Normalise one row for hashing: kind + whitespace-stripped text. */
export function normaliseHunkLine(line: HunkLine): string {
  return `${line.kind}:${line.text.replace(/\s+/g, "")}`;
}

/** Canonical hash input for a hunk's rows (exposed for tests/debugging). */
export function hunkHashInput(lines: HunkLine[]): string {
  return lines.map(normaliseHunkLine).join("\n");
}

/**
 * Content hash for a hunk's rows: SHA-256 hex truncated to 16 chars.
 * Stable across versions (ignores line numbers and whitespace); any real
 * content change — including add↔del↔ctx kind flips — hashes differently.
 */
export function hashHunkLines(lines: HunkLine[]): string {
  return sha256HexUtf8(hunkHashInput(lines)).slice(0, HUNK_HASH_LEN);
}

// --- file classification (PRD §11.1 "classify files") -----------------------
// Language-agnostic categories: Source, Tests, Docs, Config, Generated.
// Precedence: generated > tests > docs > config > source.

const TEST_DIR = /(^|\/)(tests?|__tests__|test|spec|e2e)($|\/)/;
const TEST_FILE =
  /(^|\/)(test[_-].*|.*[_-]test|.*\.(test|spec))\.[A-Za-z0-9]+$|^.*\.(test|spec)\.[A-Za-z0-9]+$/;

const DOCS_EXT = /\.(md|markdown|rst|txt|adoc|textile)$/i;
const DOCS_DIR = /(^|\/)(docs|documentation|changelog|changes|news)($|\/)/i;

const CONFIG_NAMES = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "cmakelists.txt",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "jsconfig.json",
  ".eslintrc",
  ".prettierrc",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "cmakelists",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  "docker-compose.yml",
  "docker-compose.yaml",
]);

const CONFIG_EXT = /\.(ya?ml|toml|ini|cfg|conf|json5|jsonc|properties|env)$/i;
const CONFIG_DIR = /(^|\/)(config|configs|settings|\.github|\.vscode|\.circleci)($|\/)/;

const GENERATED_RE =
  /(^|\/)(dist|build|out|target|vendor|node_modules|__pycache__|\.next|coverage)($|\/)|\.(min\.js|min\.css|bundle\.js|bundle\.css|map|lock\.data|snap)$/i;

export interface ClassifyOptions {
  /**
   * Basenames (or full paths) marked `linguist-generated` in `.gitattributes`.
   */
  linguistGenerated?: Set<string>;
}

/** Classify one repo-relative path. Pure. */
export function classifyFile(filePath: string, opts: ClassifyOptions = {}): FileCategory {
  const lower = filePath.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (opts.linguistGenerated?.has(filePath) || opts.linguistGenerated?.has(base)) {
    return "generated";
  }
  if (GENERATED_RE.test(lower)) return "generated";
  if (TEST_DIR.test(lower) || TEST_FILE.test(lower)) return "tests";
  if (DOCS_EXT.test(lower) || DOCS_DIR.test(lower)) return "docs";
  const baseNoDot = base.startsWith(".") ? base.slice(1) : base;
  if (
    CONFIG_NAMES.has(base) ||
    CONFIG_NAMES.has(baseNoDot) ||
    CONFIG_EXT.test(lower) ||
    CONFIG_DIR.test(lower)
  ) {
    return "config";
  }
  return "source";
}

/**
 * Derive a stable file key for a path (PRD §7.2 `h:`/`diff:` IDs).
 *
 * The key must be unique within a review, stable across versions, and free
 * of `:`/`@` (the ID grammar reserves those). Full paths satisfy all three,
 * so the key is the path with every non-`[A-Za-z0-9_.-]` char (including
 * `/`) mapped to `-`.
 */
export function fileKeyForPath(filePath: string): string {
  return filePath.replace(/[^A-Za-z0-9_.-]/g, "-");
}

// --- uninteresting pre-classification ----------------------------------------

const IMPORT_LINE =
  /^(?:from\s+\S+\s+import\s|import\s|export\s+(?:.*\s+from\s+)?|#include\s|using\s+[\w:.]+\s*;|use\s+[\w:]+)/;
const CONTINUATION_LINE = /^[)},\]]/;
/** A bare name in a multi-line import list: `Name,` or `"name",`. */
const NAME_LIST_LINE = /^["']?[\w$.*{}[\] ]+["']?,$/;

export interface UninterestingOptions {
  category: FileCategory;
  /** True when `.gitattributes` marks the file linguist-generated. */
  generatedFlag?: boolean;
}

/**
 * One-line hide reason, or `undefined` when the hunk stays visible.
 * Rule-based pre-classification (a later agent pass refines it); one-line
 * changes (a single changed row) are NEVER hidden (PRD §4.13). Pure.
 */
export function uninterestingReason(
  hunk: { lines: HunkLine[] },
  opts: UninterestingOptions,
): string | undefined {
  const changedRows = hunk.lines.filter((l) => l.kind !== "ctx");
  // One-line changes are never hidden (PRD §4.13).
  if (changedRows.length <= 1) return undefined;

  if (opts.generatedFlag === true || opts.category === "generated") return "generated";
  if (opts.category === "docs" || opts.category === "config") return "docs / config";

  const changed = changedRows.map((l) => l.text.trim()).filter(Boolean);
  if (changed.length === 0) return undefined;
  const allImports = changed.every(
    (c) => IMPORT_LINE.test(c) || CONTINUATION_LINE.test(c) || NAME_LIST_LINE.test(c),
  );
  if (allImports) return "imports";
  return undefined;
}

// --- ReviewFile assembly (pure part of ingest) -------------------------------

export interface BuildFilesOptions {
  /** Paths marked `linguist-generated` (caller resolves via git). */
  linguistGenerated?: Set<string>;
}

/**
 * Turn parsed files into snapshot `ReviewFile`s: classify, key, hash,
 * pre-classify uninteresting. Same function the service's ingest and the
 * web mock fixture both use, so the mock produces exactly what ingest
 * would produce for a diff. Pure.
 */
export function buildReviewFiles(parsed: ParsedFile[], opts: BuildFilesOptions = {}): ReviewFile[] {
  const gen = opts.linguistGenerated ?? new Set<string>();
  return parsed.map((f) => {
    const category = classifyFile(f.path, { linguistGenerated: gen });
    const fileKey = fileKeyForPath(f.path);
    const hunks: Hunk[] = f.hunks.map((h) => {
      const contentHash = hashHunkLines(h.lines);
      const reason = uninterestingReason(h, { category, generatedFlag: gen.has(f.path) });
      return {
        contentHash,
        header: h.header,
        ...(h.context !== undefined ? { context: h.context } : {}),
        newStart: h.newStart,
        newEnd: h.newEnd,
        oldStart: h.oldStart,
        oldEnd: h.oldEnd,
        added: h.added,
        removed: h.removed,
        lines: h.lines.map((l) => ({ ...l })),
        ...(h.noNewline ? { noNewline: true as const } : {}),
        ...(reason !== undefined ? { hiddenReason: reason } : {}),
      };
    });
    return {
      fileKey,
      path: f.path,
      category,
      hunks,
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      ...(f.isNew ? { isNew: true as const } : {}),
      ...(f.isDeleted ? { isDeleted: true as const } : {}),
      ...(f.isRename ? { isRename: true as const } : {}),
      ...(f.isBinary ? { isBinary: true as const } : {}),
    };
  });
}
