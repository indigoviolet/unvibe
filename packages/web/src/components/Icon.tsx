/**
 * Icon set copied from prototype.html (same names, same 16x16 stroke paths).
 * `gear` and `bug` are additions in the same stroke style (the prototype
 * has no settings/debug icons). Usage: `<Icon name="check" />`.
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
  reply: (
    <>
      <path d="M6.5 4L3 7.5 6.5 11" />
      <path d="M3 7.5h6.5a3.5 3.5 0 013.5 3.5v1" />
    </>
  ),
  hide: (<path d="M4 10l4-4 4 4" />),
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
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
