/**
 * SPIKE #285 — gutter width variants (evaluation only, NEVER merged).
 *
 * The variant comes from the `?gutter=` URL param (`baseline` when absent)
 * and is mirrored onto `#right` as `data-gutter-variant="a|b|c|d"` (the
 * diff root) so `gutter-variants.css` can key off it. `window.__setGutterVariant`
 * flips the attribute live for poking around; placement decisions that are
 * baked at render time (expand-control cell, dropped sign column) still
 * need a reload with the param.
 */
export type GutterVariant = "baseline" | "a" | "b" | "c" | "d";

export function gutterVariant(): GutterVariant {
  try {
    const g = new URLSearchParams(window.location.search).get("gutter");
    if (g === "a" || g === "b" || g === "c" || g === "d") return g;
  } catch {
    // Non-browser (unit tests): baseline.
  }
  return "baseline";
}

/** Variant D (and only D) collapses to a single number column. */
export function gutterSingleColumn(): boolean {
  return gutterVariant() === "d";
}

/** Variants C and D drop the `+`/`-` sign column. */
export function gutterNoSign(): boolean {
  const v = gutterVariant();
  return v === "c" || v === "d";
}

/** Variants B, C and D move the expand controls out of the number column. */
export function gutterControlsInRow(): boolean {
  const v = gutterVariant();
  return v === "b" || v === "c" || v === "d";
}

/** Mirror the URL variant onto the diff root; install the live-flip hook. */
export function applyGutterVariant(): void {
  try {
    const v = gutterVariant();
    const root = document.getElementById("right");
    if (v === "baseline") root?.removeAttribute("data-gutter-variant");
    else root?.setAttribute("data-gutter-variant", v);
    (window as unknown as { __setGutterVariant?: (next: string) => void }).__setGutterVariant = (
      next: string,
    ) => {
      const el = document.getElementById("right");
      if (!el) return;
      if (next === "baseline") el.removeAttribute("data-gutter-variant");
      else el.setAttribute("data-gutter-variant", next);
    };
  } catch {
    // Non-browser: nothing to mirror.
  }
}
