/**
 * Tree-sitter grammar loading (issue #133, stage 2).
 *
 * `web-tree-sitter` plus one prebuilt `.wasm` grammar per language, run
 * in the service. The `.wasm` files ship as plain files: the build copies
 * them into `dist/grammars/` beside the bundle, and the release ships
 * that directory — no native code, no install script, no new runtime
 * dependency, so `npm install -g` behaves the same on every platform.
 *
 * Loading cost: the runtime initialises once and each grammar loads
 * lazily on first use, then stays. Parsers are reused (parses are
 * synchronous, so sharing is safe).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, type UnitNode } from "./languages.js";

// Extension → outline language id (the eight the spike tested, plus
// obvious aliases sharing a grammar). Unknown → null (fallback runs).
const EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  pyw: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
};

/** Outline language for a repo-relative path, or null when unknown. */
export function languageOf(filePath: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(filePath);
  const lang = (m && EXT[m[1].toLowerCase()]) || null;
  return lang && LANGS[lang] ? lang : null;
}

/** Grammar `.wasm` file for a language id. */
export function grammarFile(lang: string): string {
  return `tree-sitter-${lang}.wasm`;
}

/** The eight outline languages. */
export function outlineLanguages(): string[] {
  return Object.keys(LANGS);
}

const require = createRequire(import.meta.url);

/** Directory holding the runtime + grammar `.wasm` files, when found. */
async function wasmDirs(): Promise<string[]> {
  const out: string[] = [];
  // 1. Beside the running bundle (`dist/grammars/` in releases).
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    out.push(path.join(here, "grammars"));
  } catch {
    // fileURLToPath never fails in practice; keep node_modules as fallback.
  }
  // 2. The devDependency sources (dev, tests, source checkouts).
  try {
    out.push(path.join(path.dirname(require.resolve("web-tree-sitter/package.json"))));
  } catch {
    // Not installed.
  }
  try {
    out.push(path.join(path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm"));
  } catch {
    // Not installed.
  }
  return out;
}

async function findWasm(name: string, dirs: string[]): Promise<string | null> {
  const fs = await import("node:fs");
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // Unreadable: try the next candidate.
    }
  }
  return null;
}

// Structural parser/tree views (no version-tied imports).
export interface OutlineParser {
  parse(text: string): OutlineTree | null;
}

export interface OutlineTree {
  rootNode: UnitNode & {
    hasError: boolean;
    descendantForPosition(start: { row: number; column: number }, end: { row: number; column: number }): UnitNode | null;
  };
  delete(): void;
}

interface OutlineModule {
  Parser: {
    init(opts?: { locateFile?: (name: string) => string }): Promise<void>;
    new (): {
      setLanguage(lang: unknown): void;
      parse(text: string): unknown;
      delete(): void;
    };
  };
  Language: { load(path: string): Promise<unknown> };
}

let modulePromise: Promise<OutlineModule | null> | null = null;
const parsers = new Map<string, OutlineParser>();

async function loadModule(): Promise<OutlineModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const mod = (await import("web-tree-sitter")) as unknown as OutlineModule;
        const dirs = await wasmDirs();
        const runtime = await findWasm("web-tree-sitter.wasm", dirs);
        // locateFile keeps the runtime load off fetch (file only): without
        // it the module may attempt a network load, which the privacy
        // tests forbid and which fails in any case.
        await mod.Parser.init(runtime ? { locateFile: () => runtime } : undefined);
        return mod;
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

/**
 * Parser for a language, loaded lazily once. Null when the language is
 * unknown or its grammar cannot be loaded — callers run the fallback.
 * Never throws.
 */
export async function parserFor(lang: string): Promise<OutlineParser | null> {
  if (!LANGS[lang]) return null;
  if (parsers.has(lang)) return parsers.get(lang) ?? null;
  try {
    const mod = await loadModule();
    if (!mod) return null;
    const dirs = await wasmDirs();
    const grammar = await findWasm(grammarFile(lang), dirs);
    if (!grammar) return null;
    const language = await mod.Language.load(grammar);
    const raw = new mod.Parser();
    raw.setLanguage(language);
    const parser: OutlineParser = {
      parse: (text: string) => (raw.parse(text) as unknown as OutlineTree | null),
    };
    parsers.set(lang, parser);
    return parser;
  } catch {
    return null;
  }
}

/** Test seam: forget loaded state (tests only). */
export function resetGrammarsForTests(): void {
  parsers.clear();
  modulePromise = null;
}
