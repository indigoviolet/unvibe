/**
 * D2 source pre-check (docs/d2-diagrams.md).
 *
 * The binary must not touch the network or the filesystem on the agent's
 * behalf. D2 fetches `icon:`/image `src:` URLs at compile time and reads
 * local files through imports (`...@file`, `@file`), so:
 * - `icon:`/`src:` URLs are validated against the allowlist
 *   (`icons.terrastruct.com`, https, no query/fragment, `.svg`) *before*
 *   invoking the binary — anything else is rejected and never fetched.
 *   The pipeline pre-fetches the allowlisted bytes itself, stages them,
 *   and rewrites the source to the staged file (d2 embeds local files as
 *   `data:` even with `--bundle=false`). A staged fetch that fails is
 *   stripped and the diagram renders without it.
 * - Imports are rejected before invoking the binary (no flag disables
 *   them); the process also runs in an empty temp dir with a scrubbed
 *   env (bogus proxies).
 *
 * Allowed since #286 (they render fine and the post-render sanitiser
 * strips what must not survive): `|md` / `|tex` / `|latex` labels (links
 * inside md labels are stripped), `vars:`, `d2-config:`, `classes:`
 * stanzas (d2 itself refuses non-system fonts), `tooltip:`, containers,
 * edge styles, arrowheads, grids, `sql_table`/`class`, sequence spans /
 * self-messages / notes, `near` legends. Citation `link:` values use bare
 * `diff:`/`code:`/`desc:` tokens (not URLs); other URLs in source (e.g.
 * inside md labels) are not fetched and their anchors are stripped
 * post-render.
 *
 * Still denied:
 * - imports: `...@`, `@file`, `@...` import syntax, `!include`-style lines
 * - block-string labels (`: |` at end of line — multiline `|` blocks)
 *   which produce `foreignObject` HTML the sanitiser drops
 * - animation: `style.animated` / `animated:` (needs multi-board output
 *   plus a viewer rule; not supported) and `animate-interval` (a CLI
 *   flag, not an in-source keyword — in source it is a stray shape)
 * - layers / scenarios / steps / boards (`layers:`, `scenarios:`, `steps:`,
 *   `boards:`) — multi-board diagrams, not supported.
 *   A top-level `steps: "label"` with a scalar value is renamed to
 *   `steps_box` (renameReservedShapeKeys) instead of rejected; the rest
 *   fails with a rename hint.
 * - `.class:` inside `{ … }` and bare `class:` keys (only the dotted
 *   `shape.class:` line form is valid D2).
 *
 * Caps: 40 shapes / 48 connections (measured linear to 80 shapes; the
 * timeout and the 512 KB output cap stay unchanged).
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

export const D2_MAX_SHAPES = 40;
export const D2_MAX_CONNECTIONS = 48;

const DENY_PATTERNS: { re: RegExp; reason: string }[] = [
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
    // Multiline block-string labels (`key: |` … `|`). Single-line
    // `|lang … |` / `|md … |` / `|latex … |` labels are allowed; their
    // links and foreignObject are stripped post-render.
    re: /:\s*\|(tex|code)?\s*$/m,
    reason: "`|` block-string labels are not allowed (they produce foreignObject HTML)",
  },
  {
    // Animated edges need multi-board output plus a viewer
    // reduced-motion rule (not supported): static SVG only.
    re: /\banimated\s*:/i,
    reason: "`animated:` is not allowed (animated diagrams are not supported; keep one static board)",
  },
  {
    // `animate-interval` is a d2 CLI flag, not an in-source keyword —
    // in source it renders as a stray shape labelled with the ms value.
    re: /\banimate-interval\b/i,
    reason: "`animate-interval` is not a D2 keyword (animated diagrams are not supported; keep one static board)",
  },
  {
    re: /(^|\n)\s*(layers|scenarios|steps|boards)\s*:/im,
    reason:
      "layers:/scenarios:/steps:/boards: define multi-board diagrams, which are not supported; " +
      "rename the shape instead (e.g. a box called `steps` becomes `steps_box`)",
  },
];

/**
 * Reserved D2 board keywords: never valid as shape names at the top level.
 * `layers:`/`scenarios:`/`steps:`/`boards:` with a block value define
 * multi-board diagrams, which Unvibe does not support.
 */
export const RESERVED_SHAPE_NAMES = ["layers", "scenarios", "steps", "boards"] as const;

/** Suffix applied when an unambiguous reserved-word shape is renamed. */
export const RESERVED_SHAPE_SUFFIX = "_box";

/**
 * Rename unambiguous reserved-word shapes (issue #130).
 *
 * A top-level `steps: "label"` with a same-line scalar value is a shape,
 * not a board list — D2 itself compiles it as one — so the pipeline
 * rewrites the key to `steps_box` (and every shape reference to it:
 * connection endpoints, dotted `steps.…` keys) instead of rejecting.
 * Returns the source unchanged when any use is block-form (`steps: {`),
 * collides with an existing key, or is otherwise ambiguous, leaving the
 * rejection to the pre-check.
 */
export function renameReservedShapeKeys(source: string): { source: string; renamed: string[] } {
  const lines = source.split("\n");
  const renamed: string[] = [];
  const taken = new Set<string>();
  for (const raw of lines) {
    const def = raw.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*(?:\.[A-Za-z0-9_*-]+\s*)?:/);
    if (def) taken.add(def[1].split(".")[0]);
  }
  for (const name of RESERVED_SHAPE_NAMES) {
    const target = `${name}${RESERVED_SHAPE_SUFFIX}`;
    // Every top-level `name:` line must carry a same-line scalar value
    // (quoted label or bare word — never a `{` block, `|` block string,
    // import or empty value), and the renamed key must be free.
    const defLines = lines.filter((l) => new RegExp(`^${name}\\s*:`).test(l));
    if (defLines.length === 0) continue;
    const scalar = defLines.every((l) => {
      const value = l.replace(new RegExp(`^${name}\\s*:`), "").trim();
      if (!value) return false;
      const first = value[0];
      if (first === "{" || first === "[" || first === "|" || first === "@" || first === "!") return false;
      if (/^["']/.test(value)) return true;
      // Bare scalar: one token, no inline map/list/block.
      return /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\s*\{[^}]*\}\s*)?$/.test(value) && !value.includes("{");
    });
    if (!scalar || taken.has(target)) continue;
    renamed.push(name);
    taken.add(target);
    taken.delete(name);
  }
  if (renamed.length === 0) return { source, renamed };
  const names = new Set(renamed);
  const targets = new Map([...names].map((n) => [n, `${n}${RESERVED_SHAPE_SUFFIX}`]));
  const arrow = /(<*--+>*|<*==+>*|->|<->)/;
  const out = lines.map((raw) => {
    let line = raw;
    // Top-level definition `name:` (not dotted, not indented).
    const def = line.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:/);
    if (def && names.has(def[1])) {
      line = line.replace(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)/, targets.get(def[1])!);
      return line;
    }
    // Dotted key `name.…:` at any level.
    const dot = line.match(/^(\s*)([A-Za-z0-9_][A-Za-z0-9_.-]*)\./);
    if (dot && names.has(dot[2])) {
      return line.replace(dot[2], targets.get(dot[2])!);
    }
    // Connection endpoints: first/last segments (a trailing `: label`
    // belongs to the last one) and every middle segment of a chain.
    if (arrow.test(line)) {
      const parts = line.split(arrow);
      for (let i = 0; i < parts.length; i += 2) {
        const isFirst = i === 0;
        const isLast = i === parts.length - 1;
        const seg = parts[i];
        if (isFirst || isLast) {
          // Strip a trailing `: label` on the last segment before comparing.
          const labelIdx = isLast ? seg.indexOf(":") : -1;
          const head = labelIdx >= 0 ? seg.slice(0, labelIdx) : seg;
          const bare = head.trim().replace(/^["']|["']$/g, "");
          if (names.has(bare)) {
            const replacement = head.replace(bare, targets.get(bare)!);
            parts[i] = labelIdx >= 0 ? replacement + seg.slice(labelIdx) : replacement;
          }
        } else {
          const bare = seg.trim().replace(/^["']|["']$/g, "");
          if (names.has(bare)) parts[i] = seg.replace(bare, targets.get(bare)!);
        }
      }
      return parts.join("");
    }
    return line;
  });
  return { source: out.join("\n"), renamed };
}

/**
 * `.class` / `class:` misuse (issue #130): the only class syntax D2
 * accepts is a dotted assignment on its own line (`myshape.class: [ok]`,
 * or `*.class` for every shape) — D2 passes the class through and the
 * app stylesheet paints it. Anything else (`.class:` inside `{ … }`, a
 * bare `class:` key) fails to compile, so it is rejected here with a
 * reason the repair turn can act on. Quoted labels are ignored.
 */
function findClassMisuse(source: string): string | null {
  const hint = "mark a good/bad outcome with `myshape.class: [ok]` on its own line instead";
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // Legal: `name.class: […]` / `*.class: […]` assignment lines.
    if (/^\s*[\w*][\w.*-]*\.class\s*:/.test(raw)) continue;
    const unquoted = raw.replace(/"[^"]*"|'[^']*'/g, "");
    if (/\.\s*class\s*:/.test(unquoted)) {
      return `\`.class:\` inside { ... } is not valid D2; ${hint}`;
    }
    if (/^\s*class\s*:/.test(unquoted)) {
      return `\`class:\` on its own is not valid D2; ${hint}`;
    }
  }
  return null;
}

import { extractIconUrls, validateIconUrl } from "./icons.js";

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
  // Icon / image allowlist (issue #286): every `icon:`/`src:` URL must be
  // https on exactly icons.terrastruct.com with no query/fragment and a
  // `.svg` path — anything else is rejected before compiling (never
  // fetched). A bare `shape: image` with no allowlisted `src:` cannot
  // render, so it fails here with the actionable form.
  const iconUrls = extractIconUrls(source);
  for (const url of iconUrls) {
    const valid = validateIconUrl(url);
    if (!valid.ok) return { ok: false, reason: (valid as { ok: false; reason: string }).reason };
  }
  if (/\bshape\s*:\s*image\b/i.test(source) && !iconUrls.some((u) => validateIconUrl(u).ok)) {
    return {
      ok: false,
      reason:
        "`shape: image` needs an allowlisted `src:` (only https://icons.terrastruct.com/…/*.svg, no query or fragment)",
    };
  }
  const misuse = findClassMisuse(source);
  if (misuse) return { ok: false, reason: misuse };
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
