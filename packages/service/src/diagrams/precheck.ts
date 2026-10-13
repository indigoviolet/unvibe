/**
 * D2 source pre-check (docs/d2-diagrams.md).
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
    re: /\bicon\s*:/i,
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
    re: /\btooltip\s*:/i,
    reason: "`tooltip:` is not allowed (citations use link:, never tooltips)",
  },
  {
    re: /(^|\n)\s*(layers|scenarios|steps|boards)\s*:/im,
    reason:
      "layers:/scenarios:/steps:/boards: define multi-board diagrams, which are not supported; " +
      "rename the shape instead (e.g. a box called `steps` becomes `steps_box`)",
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
