/**
 * Shiki highlighter singleton (spike/shiki-highlighting, Refs #23).
 *
 * - JavaScript regex engine only (`shiki/engine/javascript`): no WASM, so
 *   no `wasm-unsafe-eval` in the security policy, no workers, no CDN — every
 *   grammar/theme chunk is bundled and served from our own origin.
 * - One CSS-variables theme (`unvibe`, prefix `--shk-`): token spans carry
 *   `var(--shk-token-…)` colours, so light/dark switches are pure CSS and
 *   never re-tokenise (see `highlight.css`).
 * - Languages load lazily per language (`importLanguage`): one chunk each,
 *   first requested when a visible hunk needs it.
 * - Results cache by `lang:contentHash` and survive WebSocket re-renders;
 *   in-flight requests dedupe.
 * - Never throws: every failure degrades to plain text (null).
 */

import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { detectLanguage, importLanguage, type ShikiLangId } from "./language.js";
import { cacheKey, tokenizeHunk, type LineTokens, type RawToken } from "./tokenize.js";
import type { Hunk } from "@unvibe/shared";

const THEME_NAME = "unvibe";

let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore | null> | null = null;
const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<boolean>>();
const hunkCache = new Map<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] } | null>();

let version = 0;
const listeners = new Set<() => void>();

/** Bump the highlight version and wake subscribers (anchor re-marking). */
function bump(): void {
  version++;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // A subscriber must never break highlighting.
    }
  }
}

/** Current highlight version (increments as hunk tokens land). */
export function highlightVersion(): number {
  return version;
}

/** Subscribe to highlight completions. Returns an unsubscribe function. */
export function subscribeHighlight(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `?nohl=1` disables highlighting (before-screenshots + plain-paint tests). */
export function highlightDisabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("nohl");
  } catch {
    return false;
  }
}

/** Re-export for the render hook. */
export { detectLanguage };
export type { ShikiLangId };

async function getHighlighter(): Promise<HighlighterCore | null> {
  if (highlighter) return highlighter;
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const hl = await createHighlighterCore({
          langs: [],
          themes: [createCssVariablesTheme({ name: THEME_NAME, variablePrefix: "--shk-" })],
          engine: createJavaScriptRegexEngine(),
        });
        highlighter = hl;
        return hl;
      } catch {
        return null;
      }
    })();
  }
  return highlighterPromise;
}

async function ensureLang(lang: ShikiLangId): Promise<HighlighterCore | null> {
  const hl = await getHighlighter();
  if (!hl) return null;
  if (loadedLangs.has(lang)) return hl;
  let loading = loadingLangs.get(lang);
  if (!loading) {
    loading = (async () => {
      try {
        const mod = (await importLanguage(lang)) as { default?: unknown };
        await hl.loadLanguage((mod.default ?? mod) as never);
        loadedLangs.add(lang);
        return true;
      } catch {
        return false;
      } finally {
        loadingLangs.delete(lang);
      }
    })();
    loadingLangs.set(lang, loading);
  }
  return (await loading) ? hl : null;
}

function tokenizeSide(
  hl: HighlighterCore,
  lang: ShikiLangId,
  texts: string[],
): Promise<RawToken[][]> {
  // Shiki splits state across `\n` internally; join with no trailing newline
  // so the row count matches the input (a trailing `\n` yields a phantom
  // empty row). Empty sides yield no rows.
  if (texts.length === 0) return Promise.resolve([]);
  const code = texts.join("\n");
  let rows: RawToken[][];
  try {
    const result = hl.codeToTokens(code, { lang, theme: THEME_NAME });
    rows = result.tokens as unknown as RawToken[][];
  } catch {
    return Promise.reject(new Error("tokenise failed"));
  }
  if (rows.length !== texts.length) return Promise.reject(new Error("row mismatch"));
  return Promise.resolve(rows);
}

/**
 * Tokenise one hunk's both sides. Returns null when the language is
 * unknown, the highlighter/grammar failed, or the hunk trips a size cap —
 * every null renders today's plain row.
 */
export async function highlightHunk(
  hunk: Hunk,
  path: string,
): Promise<{ old: (LineTokens | null)[]; new: (LineTokens | null)[] } | null> {
  const lang = detectLanguage(path);
  if (!lang) return null;
  const key = cacheKey(hunk.contentHash, lang);
  const cached = hunkCache.get(key);
  if (cached !== undefined) return cached;
  const hl = await ensureLang(lang);
  if (!hl) {
    hunkCache.set(key, null);
    return null;
  }
  try {
    const out = await tokenizeHunk(hunk, (texts) => tokenizeSide(hl, lang, texts));
    hunkCache.set(key, out);
    if (out) bump();
    return out;
  } catch {
    hunkCache.set(key, null);
    return null;
  }
}

/** Synchronous cache read (the hook renders cached rows without waiting). */
export function cachedHunk(
  contentHash: string,
  path: string,
): { old: (LineTokens | null)[]; new: (LineTokens | null)[] } | null | undefined {
  const lang = detectLanguage(path);
  if (!lang) return null;
  return hunkCache.get(cacheKey(contentHash, lang));
}

/** Test/spike introspection: cache size and loaded languages. */
export function highlightStats(): { cached: number; langs: string[] } {
  return { cached: hunkCache.size, langs: [...loadedLangs] };
}

/** Clear caches (tests only). */
export function resetHighlightForTests(): void {
  hunkCache.clear();
  loadedLangs.clear();
  loadingLangs.clear();
  highlighter = null;
  highlighterPromise = null;
}
