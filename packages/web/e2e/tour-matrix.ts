/**
 * Theme/width matrix rules (#362).
 *
 * Default: every tour scene and journey runs ONCE, at 1440px, light,
 * Default theme. No phone widths anywhere (390 is gone).
 *
 * Dark, the non-default themes (studio, console) and 960px run only for
 * the NAMED_KEEPS below — one scene each, with its reason. Each entry is
 * grounded in a past bug or a layout that changes at that width or theme;
 * when unsure the scene is left out (candidates live in the #362 report).
 *
 * `tourCombos(scene, full)` returns the slim list by default and the full
 * matrix only when `UNVIBE_TOUR_MATRIX=full`, e.g.
 * `UNVIBE_TOUR_MATRIX=full mise run visual-tour`. The full matrix never
 * runs in `check`, `test:slow`, `gate` or `test:affected`.
 *
 * Note: fit/overlay tests (d2-diagram-overlay viewports, the extension
 * side panel at 400px, the file tree at 1100px) set their own viewport
 * because the viewport size IS the behaviour under test — not a
 * permutation, so they are not part of this matrix.
 */

export interface MatrixCombo {
  readonly name: string;
  readonly width: number;
  readonly dark: boolean;
}

export interface NamedKeep {
  /** Key into SLIM_SCENES (or an inline-assert site with no loop). */
  readonly scene: string;
  /** Combo names kept beyond the 1440-light default for this scene. */
  readonly combos: readonly string[];
  /** One line: the past bug or layout that needs this width/theme. */
  readonly reason: string;
}

export const NAMED_KEEPS: readonly NamedKeep[] = [
  {
    scene: "sinceB",
    combos: ["960-light"],
    reason: "960 narrow-pane wrap of the diff toolbar (#351)",
  },
  {
    scene: "reviewBarBadge",
    combos: ["960-light"],
    reason: "stacked review bar still fits on one line with the badge at 960 (j321, inline assert, no loop)",
  },
  {
    scene: "startPrList",
    combos: ["960-light"],
    reason: "#225 list/column edge alignment at narrow desktop (j225)",
  },
  {
    scene: "dataReset",
    combos: ["960-light"],
    reason: "notice card/text-column 1px edge match wide and narrow (#311)",
  },
  {
    scene: "plotlines",
    combos: ["960-light"],
    reason: "plotline chip stays inside the row and the trailing fold pair shares a line at 960 (j353, inline asserts, #353)",
  },
  {
    scene: "main",
    combos: ["1440-dark"],
    reason: "string/comment token contrast against the dark diff row background (#196 review)",
  },
  {
    scene: "versionAccess",
    combos: ["1440-dark"],
    reason: "dark contrast of the danger inline confirm (#346)",
  },
  {
    scene: "theme",
    combos: ["studio-1440-light"],
    reason: "bundled Studio fonts actually load and shape (#196)",
  },
  {
    scene: "theme",
    combos: ["console-1440-light"],
    reason: "Console theme-variable scoping, hatched diff markers (#196/#164)",
  },
  {
    scene: "diffStickyBar",
    combos: ["960-light"],
    reason: "actions bar wraps at narrow widths keeping the fold pair on one row (moved from 700px, #351/#353)",
  },
  {
    scene: "reviewbarNarrow",
    combos: ["960-light"],
    reason: "review bar with the boxed PR link never overflows the narrow desktop window (moved from 800px, #245)",
  },
  {
    scene: "threads",
    combos: ["1440-dark"],
    reason: "#374 margin pill contrast and gutter clipping in dark",
  },
  {
    scene: "threads",
    combos: ["960-light"],
    reason: "#374 margin pill stays inside the gutter at narrow width",
  },
];

/**
 * Slim combo names per loop scene (matched against each combo's `name`).
 * Scenes absent here default to their first combo (always 1440-light).
 */
export const SLIM_SCENES: Record<string, readonly string[]> = {
  main: ["1440-light", "1440-dark"],
  gutterE2: ["1440-light"],
  hiddenHunk: ["1440-light"],
  theme: ["studio-1440-light", "console-1440-light"],
  startStudio: ["studio-1440-light"],
  preparing: ["default-1440-light"],
  fileTab: ["1440-light"],
  removeConfirm: ["1440-light"],
  removeFlash: ["1440-light"],
  redo: ["1440-light"],
  dataReset: ["1440-light", "960-light"],
  versionAccess: ["1440-light", "1440-dark"],
  sinceB: ["1440-light", "960-light"],
  sinceCommit: ["1440-light"],
  sinceOffer: ["1440-light"],
  tour218: ["default-light-1440", "studio-light-1440", "console-light-1440"],
  startPrList: ["1440-light", "960-light"],
  prListMore: ["1440-light"],
  selectPopup: ["1440-light"],
  traces: ["1440-light"],
  hiddenRows: ["1440-light"],
  reviewbarPr: ["default-light"],
  reviewbarNarrow: ["1440-light", "960-light"],
  docBar: ["default-light"],
  threads: ["1440-light", "1440-dark", "960-light"],
  demoBanner: ["1440"],
  demoBannerStatic: ["1440"],
  // Inline-assert sites with no combo loop: the slim widths asserted there.
  reviewBarBadge: ["1440-light", "960-light"],
  plotlines: ["1440-light", "960-light"],
  diffStickyBar: ["1440-light", "960-light"],
};

/** True only for an on-demand full-matrix run; never set in the gate. */
export function fullMatrix(): boolean {
  return process.env["UNVIBE_TOUR_MATRIX"] === "full";
}

/**
 * Pick the combos to run for a loop scene: the slim list by default,
 * the full matrix when `UNVIBE_TOUR_MATRIX=full`.
 */
export function tourCombos<T extends { readonly name: string }>(
  scene: string,
  full: readonly T[],
): readonly T[] {
  if (fullMatrix()) return full;
  const slim = SLIM_SCENES[scene];
  if (!slim) return full.slice(0, 1);
  return full.filter((c) => slim.includes(c.name));
}
