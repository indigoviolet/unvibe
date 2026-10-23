/**
 * Icon set copied from prototype.html (same names, same 16x16 stroke paths).
 * `gear` and `bug` are additions in the same stroke style (the prototype
 * has no settings/debug icons), as are `person` (author avatar for the
 * reviewer; the agent avatar reuses `spark`), `refresh`, `home` and the
 * gutter caret pairs. `fold`/`unfold` (mirrored chevrons-in/out),
 * `eyeOff`, and `doc` (a page with a folded corner for the documents
 * screen) are additions in the same stroke style. #224 adds the PR
 * state/decision set (`pr-open`, `pr-draft`, `pr-merged`, `pr-closed`,
 * `request-changes`, `eye`) in the same style; approved reuses `check`.
 * Usage: `<Icon name="check" />`.
 */
import type { JSX } from "react";

const PATHS: Record<string, JSX.Element> = {
  down: (<path d="M4 6l4 4 4-4" />),
  right: (<path d="M6 4l4 4-4 4" />),
  check: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8.2l1.8 1.8 3.3-3.6" />
    </>
  ),
  spark: (<path d="M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z" />),
  note: (<path d="M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2z" />),
  trash: (<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />),
  undo: (
    <>
      <path d="M5.5 3.5L2.5 6.5l3 3" />
      <path d="M2.5 6.5H10a3.5 3.5 0 010 7H7.5" />
    </>
  ),
  bulb: (<path d="M6 13.5h4M6.3 11.2h3.4M8 2.2a4 4 0 00-2.5 7.1v1.9h5V9.3A4 4 0 008 2.2z" />),
  diagram: (
    <>
      <rect x="2" y="2.5" width="5" height="4" rx="1" />
      <rect x="9" y="9.5" width="5" height="4" rx="1" />
      <path d="M4.5 6.5v3.5h4.5" />
    </>
  ),
  comment: (<path d="M2.5 3h11v7.5h-6.2L4.5 13v-2.5h-2z" />),
  code: (<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />),
  x: (<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />),
  open: (<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4" />),
  send: (
    <>
      <path d="M2.5 7.5L13.5 2.5 9 13.5 7.5 9z" />
      <path d="M7.5 9L13.5 2.5" />
    </>
  ),
  bookmark: (<path d="M4.5 2.5h7v11L8 10.5l-3.5 3z" />),
  pin: (
    <>
      <path d="M8 1.8a4.2 4.2 0 014.2 4.2c0 3-4.2 8.2-4.2 8.2S3.8 9 3.8 6A4.2 4.2 0 018 1.8z" />
      <circle cx="8" cy="6" r="1.5" />
    </>
  ),
  reply: (
    <>
      <path d="M6.5 4L3 7.5 6.5 11" />
      <path d="M3 7.5h6.5a3.5 3.5 0 013.5 3.5v1" />
    </>
  ),
  hide: (<path d="M4 10l4-4 4 4" />),
  fold: (
    <>
      <path d="M4 3.5l4 3.5 4-3.5" />
      <path d="M4 12.5l4-3.5 4 3.5" />
    </>
  ),
  unfold: (
    <>
      <path d="M4 7l4-3.5L12 7" />
      <path d="M4 9l4 3.5L12 9" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2 8c1.6-3 3.6-4.5 6-4.5S12.4 5 14 8c-1.6 3-3.6 4.5-6 4.5S3.6 11 2 8z" />
      <path d="M3 13.5L13 3" />
    </>
  ),
  upUp: (
    <>
      <path d="M4 7.5l4-4 4 4" />
      <path d="M4 12.5l4-4 4 4" />
    </>
  ),
  downDown: (
    <>
      <path d="M4 3.5l4 4 4-4" />
      <path d="M4 8.5l4 4 4-4" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
    </>
  ),
  bug: (
    <>
      <circle cx="8" cy="9" r="3.4" />
      <path d="M8 5.6V3M5.2 6.6L3.2 5.2M10.8 6.6l2-1.4M4.6 9H2.2M13.8 9h-2.4M5.2 11.2l-2 2M10.8 11.2l2 2" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.4" r="2.5" />
      <path d="M2.9 13.8a5.1 5.1 0 015.1-4.4 5.1 5.1 0 015.1 4.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.8 8a5.8 5.8 0 1 1-1.7-4.1" />
      <path d="M13.8 1.7v3h-3" />
    </>
  ),
  home: (
    <>
      <path d="M2.5 7L8 2.5 13.5 7" />
      <path d="M4 6.5V13.5h8V6.5" />
    </>
  ),
  filter: (<path d="M2.5 3h11l-4.3 4.9v4.8L6.8 13.8V7.9z" />),
  unified: (
    <>
      <path d="M3 3.5h10" />
      <path d="M3 8h10" />
      <path d="M3 12.5h10" />
    </>
  ),
  split: (
    <>
      <path d="M8 2.5v11" />
      <path d="M2.5 5h3M2.5 8h3M2.5 11h3M10.5 5h3M10.5 8h3M10.5 11h3" />
    </>
  ),
  /**
   * #224 PR state/decision icons (same 16x16 stroke style). `pr-open` is
   * the branch-and-merge shape; `pr-draft` the same shape dashed
   * (incomplete); `pr-merged` two branches joining one node; `pr-closed`
   * a circled X (mirroring `check`'s circled tick for approved);
   * `request-changes` a circled `!`; `eye` the open counterpart of
   * `eyeOff` for review required.
   */
  "pr-open": (
    <>
      <circle cx="4.5" cy="4" r="1.7" />
      <circle cx="4.5" cy="12" r="1.7" />
      <path d="M4.5 5.7v4.6" />
      <path d="M4.5 8h4a2.5 2.5 0 012.5 2.5V12" />
    </>
  ),
  "pr-draft": (
    <>
      <circle cx="4.5" cy="4" r="1.7" strokeDasharray="2.2 1.6" />
      <circle cx="4.5" cy="12" r="1.7" strokeDasharray="2.2 1.6" />
      <path d="M4.5 5.7v4.6" strokeDasharray="2.2 1.6" />
      <path d="M4.5 8h4a2.5 2.5 0 012.5 2.5V12" strokeDasharray="2.2 1.6" />
    </>
  ),
  "pr-merged": (
    <>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="8" r="1.6" />
      <path d="M5.5 4.6c2.2 0 2.2 1.8 4.7 2.6" />
      <path d="M5.5 11.4c2.2 0 2.2-1.8 4.7-2.6" />
    </>
  ),
  "pr-closed": (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.2 6.2l3.6 3.6M9.8 6.2l-3.6 3.6" />
    </>
  ),
  "request-changes": (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6v3.8M8 11.4v.2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 8c1.6-3 3.6-4.5 6-4.5S12.4 5 14 8c-1.6 3-3.6 4.5-6 4.5S3.6 11 2 8z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  doc: (
    <>
      <path d="M4 2h5.5L12 4.5V14H4z" />
      <path d="M9.5 2v2.5H12" />
      <path d="M6 7.5h4M6 10h2.8" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d="M2.5 4.5h11V7h-11z" />
      <path d="M8 4.5V14" />
      <path d="M8 4.5C6.5 4.5 4.8 4 4.8 2.8 4.8 1.9 5.6 1.6 6.3 2c.9.6 1.4 1.8 1.7 2.5z" />
      <path d="M8 4.5c1.5 0 3.2-.5 3.2-1.7 0-.9-.8-1.2-1.5-.8-.9.6-1.4 1.8-1.7 2.5z" />
    </>
  ),
};

/**
 * Raw inner-SVG markup for the author avatars in string-rendered contexts
 * (`floating/HoverPopover.tsx`). Same shapes as `person` / `spark` above —
 * keep them in sync. (String form trips the copy guard's milestone
 * pattern on path data; like the `d` attributes above it lives here under
 * the Icon.tsx allowlist entry, never rendered as text.)
 */
export const PERSON_SVG_INNER =
  '<circle cx="8" cy="5.4" r="2.5"/><path d="M2.9 13.8a5.1 5.1 0 015.1-4.4 5.1 5.1 0 015.1 4.4"/>';
export const SPARK_SVG_INNER =
  '<path d="M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z"/>';

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
