/**
 * Enclosing units for a hunk range (issue #133, stage 2).
 *
 * Orchestration over the grammar loader and the two finders:
 * - known language + parseable file → tree-sitter rules (`languages.ts`);
 * - unknown language, missing grammar, load/parse failure, or an error
 *   tree yielding nothing → indentation fallback (`heuristic.ts`);
 * - oversize or minified files → neither (`how: "none"`).
 *
 * A wrong or missing unit degrades to expand-by-lines: this never throws
 * and never returns a partial guess — `chain` is empty when nothing
 * exact was found.
 *
 * Loading cost: grammars load lazily once; parsed trees cache by file
 * content hash (bounded, LRU, freed on evict); parses serialise so two
 * huge files cannot spike wasm memory together; files over
 * `MAX_OUTLINE_BYTES` never parse (the spike's 3.1 MB file took ~0.5 s
 * and ~150 MB — kept out by the cap).
 */
import { createHash } from "node:crypto";
import type { EnclosingUnit, OutlineHow } from "@unvibe/shared";
import { heuristicChain } from "./heuristic.js";
import { chainFrom, LANGS, type UnitAdapter, type UnitNode } from "./languages.js";
import { languageOf, parserFor, type OutlineTree } from "./grammars.js";

/** Files over this many bytes never parse (they expand by lines). */
export const MAX_OUTLINE_BYTES = 1_000_000;
/** A line this long means minified output: line units mean nothing there. */
export const MAX_OUTLINE_LINE_CHARS = 20_000;
/** Parsed trees kept by content hash (LRU; freed on evict). */
export const MAX_CACHED_TREES = 5;

interface CachedParse {
  hash: string;
  lang: string;
  tree: OutlineTree;
  hasError: boolean;
}

const treeCache = new Map<string, CachedParse>();
// Parses serialise: one sync tree-sitter parse blocks the loop, so two
// huge files must not stack their blocks and memory spikes together.
let parseQueue: Promise<void> = Promise.resolve();

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function touch(key: string): void {
  const found = treeCache.get(key);
  if (!found) return;
  treeCache.delete(key);
  treeCache.set(key, found);
}

function store(key: string, entry: CachedParse): void {
  treeCache.delete(key);
  treeCache.set(key, entry);
  while (treeCache.size > MAX_CACHED_TREES) {
    const oldest = treeCache.keys().next();
    if (oldest.done) break;
    const evicted = treeCache.get(oldest.value);
    treeCache.delete(oldest.value);
    try {
      evicted?.tree.delete();
    } catch {
      // Best effort.
    }
  }
}

const adapter: UnitAdapter = {
  kind: (n) => n.type,
  parent: (n) => n.parent,
  prev: (n) => n.previousSibling,
  next: (n) => n.nextSibling,
  text: (n) => n.text,
  children: (n) => n.namedChildren,
  rows: (n) => {
    const e = n.endPosition;
    return [n.startPosition.row, e.column === 0 && e.row > n.startPosition.row ? e.row - 1 : e.row];
  },
  name: (n) => {
    const id = n.childForFieldName?.("name");
    if (id) return id.text;
    return n.text.split("\n")[0].slice(0, 60);
  },
};

function coveringNode(root: UnitNode, lines: string[], a: number, b: number): UnitNode | null {
  const first = lines[a - 1] ?? "";
  const last = lines[b - 1] ?? "";
  const tree = root as OutlineTree["rootNode"];
  return tree.descendantForPosition(
    { row: a - 1, column: first.length - first.trimStart().length },
    { row: b - 1, column: Math.max(0, last.trimEnd().length) },
  );
}

export interface OutlineResult {
  chain: EnclosingUnit[];
  how: OutlineHow;
  language: string | null;
  totalLines: number;
}

/**
 * Enclosing units for 1-based inclusive [start, end] of `text`.
 * Never throws; out-of-range asks answer an empty parser chain.
 */
export async function enclosingUnits(
  filePath: string,
  text: string,
  start: number,
  end: number,
): Promise<OutlineResult> {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  if (start < 1 || end < start || end > totalLines || totalLines === 0) {
    return { chain: [], how: "parser", language: languageOf(filePath), totalLines };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_OUTLINE_BYTES) {
    return { chain: [], how: "none", language: languageOf(filePath), totalLines };
  }
  let longest = 0;
  for (const line of lines) longest = Math.max(longest, line.length);
  if (longest > MAX_OUTLINE_LINE_CHARS) {
    return { chain: [], how: "none", language: languageOf(filePath), totalLines };
  }
  const lang = languageOf(filePath);
  if (lang) {
    const chain = await parseChain(lang, text, lines, start, end);
    if (chain) return { chain, how: "parser", language: lang, totalLines };
  }
  const heuristic = heuristicChain(text, start, end);
  return {
    chain: heuristic,
    how: heuristic.length > 0 ? "heuristic" : "none",
    language: lang,
    totalLines,
  };
}

/**
 * Grammar chain for the range, or null when the fallback should run
 * (no parser, parse failure, or an error tree yielding nothing).
 */
async function parseChain(
  lang: string,
  text: string,
  lines: string[],
  start: number,
  end: number,
): Promise<EnclosingUnit[] | null> {
  const hash = contentHash(text);
  const key = `${lang}:${hash}`;
  const hit = treeCache.get(key);
  if (hit) {
    touch(key);
    return chainFromTree(hit, lines, start, end);
  }
  let outcome: EnclosingUnit[] | null = null;
  const task = parseQueue.then(async () => {
    try {
      const parser = await parserFor(lang);
      if (!parser) {
        outcome = null;
        return;
      }
      const tree = parser.parse(text);
      if (!tree) {
        outcome = null;
        return;
      }
      const hasError = tree.rootNode.hasError;
      store(key, { hash, lang, tree, hasError });
      outcome = chainFromTree({ hash, lang, tree, hasError }, lines, start, end);
    } catch {
      outcome = null;
    }
  });
  parseQueue = task.catch(() => {});
  await task;
  return outcome;
}

function chainFromTree(cached: CachedParse, lines: string[], start: number, end: number): EnclosingUnit[] | null {
  let node: UnitNode | null = null;
  try {
    node = coveringNode(cached.tree.rootNode, lines, start, end);
  } catch {
    node = null;
  }
  if (!node) return null;
  let chain: EnclosingUnit[] = [];
  try {
    chain = chainFrom(LANGS[cached.lang], adapter, node, start - 1, end - 1);
  } catch {
    return null;
  }
  // Error-region guesses were dropped inside; when the tree has errors
  // and nothing exact survived, the fallback reads better than nothing.
  if (cached.hasError && chain.length === 0) return null;
  return chain;
}

/** Test seam: cache size + forgetfulness (tests only). */
export function outlineCacheStats(): { size: number } {
  return { size: treeCache.size };
}

export function resetOutlineForTests(): void {
  for (const cached of treeCache.values()) {
    try {
      cached.tree.delete();
    } catch {
      // Best effort.
    }
  }
  treeCache.clear();
  parseQueue = Promise.resolve();
}
