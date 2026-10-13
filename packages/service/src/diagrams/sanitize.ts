/**
 * D2 SVG post-processing + sanitisation.
 *
 * The source is agent-written, so the SVG is untrusted. Pipeline:
 * 1. Rewrite citation anchors `<a href="diff:…">` → the app's hover/reveal
 *    attributes (`href="#" data-refs/data-src`, plus `data-unverified`).
 *    No other `href` survives.
 * 2. Drop `<title>` tooltips containing token patterns (native tooltips
 *    would fight the app's rich hover preview).
 * 3. Strict allowlist sanitisation (no `script`, no `foreignObject`, no
 *    event handlers, no external URLs, fonts only as embedded `data:`).
 * 4. Namespace `id`s per diagram (D2's `--salt` already does most of this;
 *    the sanitiser prefixes any remaining bare ids with the hash so two
 *    inlined diagrams can never collide).
 */

export interface CitationRewrite {
  /** Canonical token to store in data-refs/data-src. */
  canonical: string;
  /** True when the citation is unverified (adds data-unverified="true"). */
  unverified?: boolean;
}

/**
 * Map from the raw `link:` token as written in D2 source (bare form,
 * e.g. `diff:conn:80-88`) to its rewrite. Keys should include both the
 * raw and canonical forms; lookup falls back to treating the href itself
 * as the canonical token when it parses as a citation.
 */
export type CitationMap = Map<string, CitationRewrite>;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** True when the href looks like a citation token (not a URL). */
function isCitationHref(href: string): boolean {
  const t = href.trim();
  if (/^https?:\/\//i.test(t) || t.startsWith("//") || t.startsWith("data:") || t.startsWith("javascript:")) {
    return false;
  }
  // Bare tokens: diff:/code:/desc:/h:.
  const bare = t.split("|")[0].trim();
  return /^(diff|code|desc|h):[^:]+:.+|^(diff|code|desc|h):[^:]+$|^desc:[^:]+$/.test(bare) || /^(diff|code|desc):/.test(bare);
}

function bareOf(href: string): string {
  const t = href.trim();
  const pipe = t.indexOf("|");
  if (pipe >= 0) t = t.slice(0, pipe).trim();
  return t;
}

/**
 * Rewrite citation anchors. Every `<a href="diff:…">` (and `xlink:href`
 * twin) becomes `<a href="#" data-refs="<canonical>" data-src="<canonical>">`
 * plus `data-unverified="true"` when unverified. Non-citation `<a>` wrappers
 * are unwrapped (tags removed, inner kept). All other `href`/`xlink:href`
 * are stripped later by the allowlist stage.
 */
export function rewriteCitationAnchors(svg: string, citations: CitationMap): string {
  return svg.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (full, attrs: string, inner: string) => {
    const hrefM = attrs.match(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    const xhrefM = attrs.match(/\bxlink:href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    const rawHref = hrefM ? stripQuotes(hrefM[1]) : xhrefM ? stripQuotes(xhrefM[1]) : "";
    if (rawHref && isCitationHref(rawHref)) {
      const bare = bareOf(rawHref);
      const hit = citations.get(bare) ?? citations.get(rawHref.trim());
      const canonical = hit?.canonical ?? bare;
      const unverified = hit?.unverified ? ` data-unverified="true"` : "";
      return `<a href="#" data-refs="${escapeAttr(canonical)}" data-src="${escapeAttr(canonical)}"${unverified}>${inner}</a>`;
    }
    // Non-citation link: unwrap (drop the anchor, keep content).
    return inner;
  });
}

function stripQuotes(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Drop `<title>` elements whose text contains token patterns. */
export function stripTokenTitles(svg: string): string {
  return svg.replace(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi, (full, text: string) => {
    if (/(diff|code|desc|h):/.test(text) || /\[\[/.test(text)) return "";
    return full;
  });
}

// --- allowlist sanitisation ----------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "a", "rect", "circle", "ellipse", "line", "path", "polygon",
  "polyline", "text", "tspan", "defs", "marker", "mask", "clipPath", "style",
  "title", "desc", "stop", "linearGradient", "radialGradient", "pattern", "use", "symbol",
]);

const DROP_ENTIRELY = new Set([
  "script", "foreignobject", "iframe", "object", "embed", "link", "meta",
  "html", "body", "base", "form", "input", "button", "video", "audio",
  "image", "foreignObject", "use", // <use> can reference external content; D2 doesn't need it
]);

/** Attributes allowed on any element (plus data-* and aria-*). */
const ALLOWED_ATTRS = new Set([
  "id", "class", "x", "y", "dx", "dy", "width", "height", "rx", "ry", "cx", "cy", "r",
  "x1", "y1", "x2", "y2", "points", "d", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity",
  "fill-opacity", "opacity", "transform", "viewbox", "viewBox",
  "preserveAspectRatio", "xmlns", "xmlns:xlink", "role", "aria-label",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "alignment-baseline", "clip-path", "mask", "maskUnits",
  "marker-start", "marker-mid", "marker-end", "orient", "refX", "refY",
  "markerWidth", "markerHeight", "markerUnits", "offset", "stop-color",
  "stop-opacity", "style", "href", "xlink:href", "data-refs", "data-src",
  "data-unverified", "clip-rule", "fill-rule", "stroke-miterlimit",
  "letter-spacing", "word-spacing", "text-decoration", "direction",
]);

function isAllowedAttr(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("data-") || n.startsWith("aria-")) return true;
  if (ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(n)) return true;
  return false;
}

/** Scrub a style attribute value: drop external url(), javascript:, @import. */
function scrubStyleValue(v: string): string {
  let out = v;
  // Drop url(...) unless internal #id or data:.
  out = out.replace(/url\(\s*([^)]*?)\s*\)/gi, (m, inner: string) => {
    const t = inner.trim().replace(/^["']|["']$/g, "");
    if (t.startsWith("#") || t.startsWith("data:")) return m;
    return "none";
  });
  // Drop javascript: / vbscript: / @import remnants.
  out = out.replace(/javascript\s*:/gi, "").replace(/vbscript\s*:/gi, "").replace(/@import[^;]+;?/gi, "");
  return out;
}

/** Scrub a <style> block: no @import, no external url(), no @font-face remote src. */
export function scrubStyleBlock(css: string): string {
  let out = css.replace(/@import[^;]+;?/gi, "");
  out = out.replace(/url\(\s*([^)]*?)\s*\)/gi, (m, inner: string) => {
    const t = String(inner).trim().replace(/^["']|["']$/g, "");
    if (t.startsWith("#") || t.startsWith("data:")) return m;
    return `url("#blocked")`;
  });
  // Drop any remaining javascript: / expression( (old IE).
  out = out.replace(/javascript\s*:/gi, "").replace(/expression\s*\(/gi, "(");
  return out;
}

function sanitizeAttrs(tagName: string, attrs: string): string {
  const out: string[] = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) {
    const name = m[1];
    const rawVal = m[2] ?? "";
    const lname = name.toLowerCase();
    // Drop event handlers, form actions, and XML event attrs.
    if (/^on/i.test(name) || lname === "formaction" || lname === "xlink:show" || lname === "xlink:actuate") continue;
    if (!isAllowedAttr(name)) continue;
    let val = rawVal ? stripQuotes(rawVal) : "";
    if (lname === "href" || lname === "xlink:href") {
      const t = val.trim();
      // Only # and #id survive (citation anchors were already rewritten to #).
      if (t === "#" || t.startsWith("#")) {
        out.push(`${name}="${escapeAttr(t)}"`);
      }
      continue;
    }
    if (lname === "style") {
      val = scrubStyleValue(val);
      if (!val.trim()) continue;
      out.push(`${name}="${escapeAttr(val)}"`);
      continue;
    }
    // Drop javascript:/data:(non-font)/vbscript: in any other attr.
    if (/^\s*javascript\s*:/i.test(val) || /^\s*vbscript\s*:/i.test(val)) continue;
    out.push(rawVal ? `${name}="${escapeAttr(val)}"` : name);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

/**
 * Strict SVG sanitisation. Removes dangerous elements, filters attributes,
 * scrubs style blocks, and ensures no external href/url survives.
 */
export function sanitizeSvg(svg: string): string {
  let out = svg;
  // Strip XML declaration, DOCTYPE, comments, processing instructions.
  out = out.replace(/<\?xml[^?]*\?>\s*/gi, "");
  out = out.replace(/<!DOCTYPE[^>]*>\s*/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // Drop dangerous elements entirely (with content).
  for (const tag of ["script", "foreignObject", "foreignobject", "iframe", "object", "embed"]) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    out = out.replace(re, "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/\\s*>`, "gi"), "");
  }
  // Drop <image> (external raster; precheck rejects the sources that need it).
  out = out.replace(/<image\b[^>]*>([\s\S]*?<\/image\s*>)?/gi, "");
  // Scrub <style> blocks but keep them (D2 needs its classes + embedded fonts).
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_m, attrs: string, css: string) => {
    return `<style${sanitizeAttrs("style", attrs)}>${scrubStyleBlock(css)}</style>`;
  });
  // Filter every other tag through the allowlist.
  out = out.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)\b([^>]*)\/?>/g, (full, tagName: string, attrs: string) => {
    const closing = full.startsWith("</");
    const selfClose = /\/\s*>$/.test(full);
    if (DROP_ENTIRELY.has(tagName) || DROP_ENTIRELY.has(tagName.toLowerCase())) {
      return "";
    }
    if (!ALLOWED_ELEMENTS.has(tagName) && !ALLOWED_ELEMENTS.has(tagName.toLowerCase())) {
      // Unknown element: unwrap (drop tags, keep inner text handled by regex pass).
      return "";
    }
    if (closing) return `</${tagName}>`;
    const clean = sanitizeAttrs(tagName, attrs);
    return selfClose ? `<${tagName}${clean}/>` : `<${tagName}${clean}>`;
  });
  return out;
}

/**
 * Namespace `id="…"` attributes with the diagram hash and rewrite internal
 * references (`url(#…)`, `href="#…"`) to match. D2's `--salt` already
 * namespaces most ids; this is defence-in-depth for inlined pages.
 */
export function namespaceIds(svg: string, hash: string): string {
  const prefix = `d2-${hash}`;
  const ids = new Set<string>();
  for (const m of svg.matchAll(/\bid\s*=\s*"([^"]+)"/g)) {
    if (m[1] && !m[1].startsWith(prefix)) ids.add(m[1]);
  }
  let out = svg;
  for (const id of ids) {
    const namespaced = `${prefix}-${id}`;
    out = out.replace(new RegExp(`\\bid\\s*=\\s*"${escapeRegExp(id)}"`, "g"), `id="${namespaced}"`);
    out = out.replace(new RegExp(`url\\(\\s*#${escapeRegExp(id)}\\s*\\)`, "g"), `url(#${namespaced})`);
    out = out.replace(new RegExp(`href\\s*=\\s*"#${escapeRegExp(id)}"`, "g"), `href="#${namespaced}"`);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Full post-processing: anchor rewriting → title stripping → sanitising →
 * id namespacing. `hash` is the diagram content hash (for namespacing).
 */
export function postProcessSvg(svg: string, citations: CitationMap, hash: string): string {
  let out = rewriteCitationAnchors(svg, citations);
  out = stripTokenTitles(out);
  out = sanitizeSvg(out);
  out = namespaceIds(out, hash);
  return out;
}
