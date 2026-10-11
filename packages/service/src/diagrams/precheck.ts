/**
 * D2 source pre-check (docs/diagram-options.md §7, "subprocess hygiene").
 *
 * The binary must not touch the network or the filesystem on the agent's
 * behalf. D2 can fetch `icon:`/image URLs (bundling) and read local files
 * through imports (`...@file`, `@file`). We reject such sources *before*
 * invoking the binary, pass `--bundle=false`, run in an empty temp dir,
 * and scrub the subprocess env (bogus proxies).
 *
 * Denied (documented list):
 * - `icon:` (remote or local icon fetches, including `icon:` URLs)
 * - `shape: image` (image shapes fetch `src:` URLs)
 * - imports: `...@`, `@file`, `@...` import syntax, `!include`-style lines
 * - Markdown/LaTeX/code-block labels (`|md`, `|latex`, trailing `|` blocks)
 *   which produce `foreignObject` HTML in the SVG
 * - `vars:`, `d2-config`, `classes:` with external refs? (vars/d2-config
 *   can smuggle styles; rejected)
 * - layers / scenarios / steps / boards (`layers:`, `scenarios:`, `steps:`,
 *   `boards:`, `...@` board refs) — playground extras, out of scope
 * - http(s) URLs anywhere (image `src:`, `link:` is allowed only for
 *   citation tokens, not URLs — actual URLs are rejected; citations use
 *   bare `diff:`/`code:`/`desc:` tokens which are not URLs)
 *
 * Caps: 12 shapes / 16 connections (keeps renders fast and layouts sane).
 * Input byte cap is enforced by the renderer (not here).
 */

export interface PrecheckOk {
  ok: true;
}

export interface PrecheckFail {
  ok: false;
  reason: string;
}

export type PrecheckResult = PrecheckOk | PrecheckFail;

export const D2_MAX_SHAPES = 12;
export const D2_MAX_CONNECTIONS = 16;

const DENY_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    // icon: https://… or icon: local.svg — both trigger bundling fetches.
    // Probe §9 #1: the binary GETs icon URLs at compile; unfetchable URLs
    // fail the whole render. Reject pre-compile (no flag disables it).
    re: /(^|\n)\s*[a-zA-Z0-9_."'\][*{}()| -]*\bicon\s*:/im,
    reason: "`icon` is not allowed (it fetches remote/local images)",
  },
  {
    re: /\bshape\s*:\s*image\b/i,
    reason: "`shape: image` is not allowed (it fetches image URLs)",
  },
  {
    // D2 imports read arbitrary local files (absolute and cwd-relative;
    // probe §9 #2). There is NO CLI flag to disable them: reject
    // pre-compile and run with cwd = empty temp dir.
    re: /\.\.\.@|@file\b|^\s*@\w/m,
    reason: "imports (`...@`, `@file`) are not allowed (they read local files)",
  },
  {
    // `: @…` import value form (`x: @foo`, `x: @file:…`).
    re: /:\s*@\S/,
    reason: "imports (`: @…`) are not allowed (they read local files)",
  },
  {
    re: /^\s*!include\b/im,
    reason: "`!include` is not allowed (it reads local files)",
  },
  {
    // Markdown / TeX / LaTeX labels. Probe §9 #3: md links become real
    // external <a href>; reject pre-compile, href allowlist is the backstop.
    re: /\|\s*md\b/i,
    reason: "`|md` Markdown labels are not allowed",
  },
  {
    re: /\|\s*tex\b/i,
    reason: "`|tex` labels are not allowed",
  },
  {
    re: /\|\s*latex\b/i,
    reason: "`|latex` labels are not allowed (they produce foreignObject HTML)",
  },
  {
    re: /:\s*\|(tex|code)?\s*$/m,
    reason: "`|` code-block labels are not allowed (they produce foreignObject HTML)",
  },
  {
    re: /(^|\n)\s*vars\s*:/im,
    reason: "`vars:` is not allowed",
  },
  {
    re: /d2-config/i,
    reason: "`d2-config` is not allowed",
  },
  {
    // `classes:` with font keys can smuggle styles; the prompt limits say
    // no classes at all (§9 format block). Reject the whole stanza.
    re: /(^|\n)\s*classes\s*:/im,
    reason: "`classes:` is not allowed",
  },
  {
    // Native tooltips fight the app's rich hover preview; the prompt says
    // no tooltip:. Strip per contract, but also reject at pre-check so the
    // agent learns the convention (repair turn).
    re: /(^|\n)\s*[a-zA-Z0-9_."'\][*{}()| -]*\btooltip\s*:/im,
    reason: "`tooltip:` is not allowed (citations use link:, never tooltips)",
  },
  {
    re: /(^|\n)\s*(layers|scenarios|steps|boards)\s*:/im,
    reason: "layers/scenarios/steps/boards are out of scope",
  },
  {
    // http(s) URLs anywhere in source (images, icons). Citation `link:`
    // values use bare diff:/code:/desc: tokens (not URLs) and are fine;
    // this pattern only fires on actual http(s):// URLs.
    re: /https?:\/\//i,
    reason: "URLs are not allowed in diagram sources (no network fetches)",
  },
];

/**
 * Count shapes and connections heuristically:
 * - connections: occurrences of `->`, `<->`, `--`, `<--`, `-->`, `<->`, `=>`
 * - shapes: distinct shape keys (lines like `key: label` or `key.shape: …`
 *   or `key -> …` LHS/RHS identifiers), capped at the deny stage.
 */
function countConnections(source: string): number {
  const m = source.match(/<*--+>*|<*==+>*|->|<->/g);
  return m ? m.length : 0;
}

function countShapes(source: string): number {
  const keys = new Set<string>();
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // Connection: `a -> b: label` — both ends are shapes.
    const conn = line.match(/^([A-Za-z0-9_."'\][*{}()| -]+?)\s*(?:<*--+>*|<*==+>*|->|<->)\s*([A-Za-z0-9_."'\][*{}()| -]+?)(?:\s*:.*)?$/);
    if (conn) {
      const lhs = conn[1].trim().replace(/^["']|["']$/g, "");
      const rhs = conn[2].trim().replace(/^["']|["']$/g, "");
      if (lhs) keys.add(lhs.split(".")[0].split("[")[0].trim());
      if (rhs) keys.add(rhs.split(".")[0].split("[")[0].trim());
      continue;
    }
    // Shape def: `key: label` or `key.shape: …` or `key: { … }`.
    const def = line.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*(?:\.[A-Za-z0-9_-]+\s*)?:/);
    if (def) keys.add(def[1].split(".")[0]);
  }
  return keys.size;
}

/**
 * Pre-check D2 source before invoking the binary. Pure; never throws.
 * Returns `{ ok: true }` or `{ ok: false, reason }` with a one-line reason
 * suitable for the repair prompt.
 */
export function precheckD2Source(source: string): PrecheckResult {
  if (!source || !source.trim()) {
    return { ok: false, reason: "the diagram source is empty" };
  }
  for (const { re, reason } of DENY_PATTERNS) {
    if (re.test(source)) return { ok: false, reason };
  }
  const connections = countConnections(source);
  if (connections > D2_MAX_CONNECTIONS) {
    return {
      ok: false,
      reason: `too many connections (${connections} > ${D2_MAX_CONNECTIONS}); keep diagrams to ≤${D2_MAX_CONNECTIONS} connections`,
    };
  }
  const shapes = countShapes(source);
  if (shapes > D2_MAX_SHAPES) {
    return {
      ok: false,
      reason: `too many shapes (${shapes} > ${D2_MAX_SHAPES}); keep diagrams to ≤${D2_MAX_SHAPES} shapes`,
    };
  }
  return { ok: true };
}
