/**
 * Defensive client-side adopt pass for service-rendered D2 SVGs (web-guide
 * owner; D2 decision addendum).
 *
 * The service sanitises before caching, but the web app does not trust it
 * blindly: the fetched SVG text is parsed with `DOMParser` as
 * `image/svg+xml` and only adopted into the document after this pass:
 *
 * - the document must contain exactly one root `<svg>` (else reject);
 * - drop `script`, `foreignObject`, `iframe`, `object`, `embed`, `link`,
 *   `meta`, `audio`, `video` and `image` elements (remote-load risk);
 * - drop every event-handler attribute (`on*`, case-insensitive);
 * - drop every `href` / `xlink:href` that is not `#` or an internal
 *   `#fragment` (citation anchors per the contract use `href="#"`);
 * - keep `data-*` attributes (`data-refs` / `data-src` drive the existing
 *   hover preview + reveal code), `<style>` blocks and inline `style=`
 *   attributes: D2 output needs both to render (measured on d2 v0.9.0: two
 *   `<style>` blocks plus inline `style=` per diagram), so
 *   `style-src 'unsafe-inline'` stays regardless of isolation;
 * - make citation anchors keyboard-operable (`tabindex`, `aria-label`).
 *
 * Isolation (no shadow root): D2 scopes most of its CSS to a per-render
 * `.d2-<hash>` class, but a handful of selectors are global (`.shape`,
 * `.connection`, `.blend`, `.appendix …`, `.md`, `.light-code`,
 * `.dark-code`, `.appendix-icon`, measured), and two copies of the *same*
 * diagram carry identical `id`s (the hash is content-derived). A shadow
 * root would hide the anchors from the document-level hover-preview,
 * tooltip and reveal delegation that citations depend on, so instead each
 * adopted diagram gets:
 * - a unique instance class (`d2u0`, `d2u1`, …) on its root, under which
 *   every non-`@` rule of its `<style>` blocks is scoped;
 * - every `id` rewritten to `<uid>-<id>`, with `url(#…)` and internal
 *   `#…` references updated to match.
 */

const DROP_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "audio",
  "video",
  "image",
]);

let uidCounter = 0;

/** True for the only href shapes a diagram anchor may carry. */
export function isAllowedHref(value: string | null): boolean {
  return value === "#" || (value !== null && value.startsWith("#") && value.length > 1);
}

/**
 * Scope one `<style>` block's CSS text under `.uid`. Top-level rules are
 * split on `}`; `@`-rules (`@font-face` with its per-diagram `data:` fonts)
 * pass through untouched, every other selector list is prefixed. At-rules
 * with nested rule blocks (`@media`, `@supports`, `@keyframes`) are left
 * unscoped rather than mangled — d2 v0.9.0 emits none.
 */
export function scopeDiagramCss(cssText: string, uid: string): string {
  const prefix = `.${uid}`;
  const out: string[] = [];
  for (const chunk of cssText.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace < 0) {
      if (chunk.trim() !== "") out.push(chunk);
      continue;
    }
    const selector = chunk.slice(0, brace);
    const body = chunk.slice(brace);
    if (/^\s*@/.test(selector)) {
      out.push(`${selector}${body}}`);
      continue;
    }
    const scoped = selector
      .split(",")
      .map((s) => (s.trim() === "" ? s : `${prefix} ${s.trim()}`))
      .join(", ");
    out.push(`${scoped}${body}}`);
  }
  return out.join("");
}

/** Parse + sanitise + isolate one fetched SVG; null when rejected. */
export function sanitizeD2Svg(svgText: string, uid?: string): SVGSVGElement | null {
  const instance = uid ?? `d2u${uidCounter++}`;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") return null;

  // 1. Drop dangerous elements wholesale (live NodeList: iterate a copy).
  for (const el of [...doc.getElementsByTagName("*")]) {
    if (DROP_ELEMENTS.has(el.tagName.toLowerCase())) el.remove();
  }
  // 2. Rewrite ids first, collecting the rename map for references.
  const renames = new Map<string, string>();
  for (const el of [...doc.getElementsByTagName("*")]) {
    const id = el.getAttribute("id");
    if (id !== null && id !== "") {
      const next = `${instance}-${id}`;
      renames.set(id, next);
      el.setAttribute("id", next);
    }
  }
  const rewriteRefs = (value: string): string =>
    value.replace(/url\(#([^)]+)\)/g, (_, ref: string) =>
      renames.has(ref) ? `url(#${renames.get(ref)})` : `url(#${ref})`,
    );

  // 3. Scrub attributes element by element.
  for (const el of [...doc.getElementsByTagName("*")]) {
    const tag = el.tagName.toLowerCase();
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        const kept = attr.value.startsWith("#") ? attr.value : null;
        el.removeAttribute(attr.name);
        if (kept !== null && isAllowedHref(kept)) {
          const rewritten =
            kept.length > 1 && renames.has(kept.slice(1)) ? `#${renames.get(kept.slice(1))}` : kept;
          el.setAttribute(attr.name, rewritten);
        }
        continue;
      }
      if (name === "style") {
        el.setAttribute(attr.name, rewriteRefs(attr.value));
      }
    }
    if (tag === "a") {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (el.hasAttribute("data-refs") && !el.hasAttribute("aria-label")) {
        el.setAttribute(
          "aria-label",
          el.hasAttribute("data-unverified") ? "Show cited source (unverified)" : "Show cited source",
        );
      }
    }
    if (tag === "style" && el.textContent) {
      el.textContent = scopeDiagramCss(rewriteRefs(el.textContent), instance);
    }
  }

  root.classList.add(instance);
  if (!root.hasAttribute("aria-label")) root.setAttribute("aria-label", "Diagram");
  return root as unknown as SVGSVGElement;
}

/**
 * Adopt a sanitised root into the live document. Returns the adopted node,
 * or null when the input was rejected.
 */
export function adoptD2Svg(svgText: string, uid?: string): SVGSVGElement | null {
  const clean = sanitizeD2Svg(svgText, uid);
  if (!clean) return null;
  return document.importNode(clean, true) as unknown as SVGSVGElement;
}
