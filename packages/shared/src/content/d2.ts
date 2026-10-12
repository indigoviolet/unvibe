/**
 * D2 diagram convention (docs/d2-diagrams.md).
 *
 * Agents write a fenced `d2` block, optionally followed by a `Caption:` line.
 * Citations are written on shapes/connections as a quoted bare token, no
 * `[[ ]]`:
 *
 * ```d2
 * direction: right
 * server -> client: parse headers
 * client -> norm: unfold {link: "diff:conn:91-110"}
 * norm: _normalize_header_values {link: "diff:conn:80-88"}
 * ```
 *
 * Supported `link:` forms (all normalised to the bare token):
 * - `link: "diff:conn:80-88"` (the convention: quoted bare token)
 * - `link: diff:conn:80-88` (unquoted bare token)
 * - `link: "[[diff:conn:91-110]]"` (legacy bracket form, still accepted)
 * - `link: "code:src/x.py:10-20"` / `link: "desc:d-intro"` (code/desc forms)
 *
 * Pure helpers only (no Node/DOM): extraction, canonicalisation, hashing.
 */

import { sha256HexUtf8 } from "../diff.js";

/** Minimum D2 version the service accepts (verified by the spike). */
export const D2_MIN_VERSION = "0.9.0";

/**
 * Render options baked into the content hash (theme-independent).
 * CLI flags: `--layout dagre --pad 20 --no-xml-tag --bundle=false`,
 * no sketch, no animation. Theme (0 light / 200 dark) and salt vary per
 * render and are NOT part of the hash.
 */
export const D2_RENDER_OPTIONS = {
  layout: "dagre",
  pad: 20,
} as const;

/** Placeholder version when the binary is unavailable (hash still stable). */
export const D2_VERSION_UNKNOWN = "unknown";

/**
 * Post-processing (sanitise) version, baked into data-dir cache filenames
 * (`<hash>.v<POSTPROCESS_VERSION>.<theme>.svg`) but NOT into the content
 * hash: old snapshots keep addressing the same hash, while renders cached
 * by an older post-processor can never be served stale. Bump whenever
 * `postProcessSvg` keeps more (or less) of the raw render.
 */
export const DIAGRAM_POSTPROCESS_VERSION = 1;

/** Length of the diagram content hash (hex chars, like hunk hashes). */
export const DIAGRAM_HASH_LEN = 16;

/**
 * Canonicalise D2 source for hashing and rendering: LF line endings,
 * trailing whitespace stripped per line, leading/trailing blank lines
 * removed. The rendered bytes use this form so the same logical source
 * gives the same hash and the same SVG.
 */
export function canonicalizeD2Source(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const trimmed = lines.map((l) => l.replace(/[ \t]+$/g, ""));
  // Drop leading/trailing blank lines.
  let start = 0;
  while (start < trimmed.length && trimmed[start].trim() === "") start++;
  let end = trimmed.length;
  while (end > start && trimmed[end - 1].trim() === "") end--;
  return trimmed.slice(start, end).join("\n");
}

/**
 * Extract `link:` citation targets from D2 source (first-seen order,
 * deduped). Accepts quoted/unquoted and `[[…]]`-wrapped forms; strips
 * `|label` suffixes; returns bare tokens (e.g. `diff:conn:80-88`).
 * Returns [] for sources with no links.
 */
export function extractD2Links(source: string): string[] {
  const out: string[] = [];
  const push = (t: string): void => {
    const bare = bareToken(t);
    if (bare && !out.includes(bare)) out.push(bare);
  };
  // Match `link:` values: quoted ("…" / '…') or bare (up to whitespace / ; / }).
  const re = /\blink\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s;}]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw) continue;
    push(raw);
  }
  return out;
}

function bareToken(raw: string): string {
  let t = raw.trim();
  // Strip [[…]] wrapper (legacy) and optional |label.
  if (t.startsWith("[[") && t.endsWith("]]")) t = t.slice(2, -2).trim();
  const pipe = t.indexOf("|");
  if (pipe >= 0) t = t.slice(0, pipe).trim();
  // Strip surrounding quotes once more (nested quoting).
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Content hash of (canonicalised source + d2 version + render options).
 * Stable across machines; changes when the source, the binary version, or
 * the render options change (cache invalidates).
 */
export function diagramHash(source: string, d2version: string): string {
  const canon = canonicalizeD2Source(source);
  const input = `${canon}\n\x00${d2version}\n\x00${JSON.stringify(D2_RENDER_OPTIONS)}`;
  return sha256HexUtf8(input).slice(0, DIAGRAM_HASH_LEN);
}
