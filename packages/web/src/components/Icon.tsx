/**
 * Icon set: Tabler Icons (outline, v3.51), per issue #407.
 *
 * Unvibe keeps its own icon names and the `<Icon name=…>` API — only the
 * drawings come from Tabler (each icon imported individually so
 * tree-shaking drops the rest of the set). Icons draw at 16px with
 * stroke ~1.75 (`.ic` in `styles/prototype.css`); Tabler's 24-grid
 * artwork scales down to it. The mapping (Unvibe name → Tabler):
 * down → chevron-down, right → chevron-right, hide → chevron-up,
 * upUp → chevrons-up, downDown → chevrons-down, fold → fold,
 * unfold → arrows-move-vertical, home → home, open → external-link,
 * refresh → refresh, bug → bug, question → help-circle,
 * redo → refresh-alert, undo → arrow-back-up, gear → settings,
 * doc → file-text, gift → gift, filter → filter, eye → eye,
 * eyeOff → eye-off, slower → sort-descending-small-big,
 * summary → align-left, bulb → quote, diagram → hierarchy-2,
 * copy → copy, second → robot-face, spark → sparkles, code → code,
 * check → circle-check, comment → message, note → pencil,
 * reply → corner-up-left, send → send, trash → trash, x → x,
 * bookmark → bookmark, pin → pin, person → user,
 * unified → layout-rows, split → layout-columns,
 * pr-open → git-pull-request, pr-draft → git-pull-request-draft,
 * pr-merged → git-merge, pr-closed → git-pull-request-closed,
 * request-changes → file-diff.
 * Usage: `<Icon name="check" />`.
 */
import type { JSX } from "react";
import {
  IconAlignLeft,
  IconArrowBackUp,
  IconArrowsMoveVertical,
  IconBookmark,
  IconBug,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconChevronsDown,
  IconChevronsUp,
  IconCircleCheck,
  IconCode,
  IconCopy,
  IconCornerUpLeft,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFileDiff,
  IconFileText,
  IconFilter,
  IconFold,
  IconGift,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconHelpCircle,
  IconHierarchy2,
  IconHome,
  IconLayoutColumns,
  IconLayoutRows,
  IconMessage,
  IconPencil,
  IconPin,
  IconQuote,
  IconRefresh,
  IconRefreshAlert,
  IconRobotFace,
  IconSend,
  IconSettings,
  IconSortDescendingSmallBig,
  IconSparkles,
  IconTrash,
  IconUser,
  IconX,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

const COMPONENTS = {
  down: IconChevronDown,
  right: IconChevronRight,
  check: IconCircleCheck,
  spark: IconSparkles,
  note: IconPencil,
  trash: IconTrash,
  undo: IconArrowBackUp,
  // #345: re-do starts the guide over from the same change — refresh
  // with an alert mark, for the review bar's Re-do guide button.
  redo: IconRefreshAlert,
  // Issue #388: the ?-mode toggle.
  question: IconHelpCircle,
  bulb: IconQuote,
  diagram: IconHierarchy2,
  comment: IconMessage,
  code: IconCode,
  // Issue #377: copy-as-Markdown.
  copy: IconCopy,
  x: IconX,
  open: IconExternalLink,
  send: IconSend,
  bookmark: IconBookmark,
  pin: IconPin,
  reply: IconCornerUpLeft,
  hide: IconChevronUp,
  fold: IconFold,
  unfold: IconArrowsMoveVertical,
  eyeOff: IconEyeOff,
  upUp: IconChevronsUp,
  downDown: IconChevronsDown,
  gear: IconSettings,
  bug: IconBug,
  person: IconUser,
  refresh: IconRefresh,
  home: IconHome,
  filter: IconFilter,
  unified: IconLayoutRows,
  split: IconLayoutColumns,
  // #224 PR state/decision set; approved reuses `check`.
  "pr-open": IconGitPullRequest,
  "pr-draft": IconGitPullRequestDraft,
  "pr-merged": IconGitMerge,
  "pr-closed": IconGitPullRequestClosed,
  "request-changes": IconFileDiff,
  eye: IconEye,
  // Issue #301: Second opinion (a robot face for the persona runner)
  // and Summarize.
  second: IconRobotFace,
  summary: IconAlignLeft,
  // Issue #387: Help me understand (sort-descending: the slower rewrite
  // that starts small and grows).
  slower: IconSortDescendingSmallBig,
  doc: IconFileText,
  gift: IconGift,
} satisfies Record<string, TablerIcon>;

/**
 * Raw inner-SVG markup for the author avatars in string-rendered contexts
 * (`floating/HoverPopover.tsx`). Tabler 24-grid path data for `user` /
 * `sparkles` (same mapping as `person` / `spark` above) — the wrapping
 * `<svg class="ic">` there uses `viewBox="0 0 24 24"` to match. (String
 * form trips the copy guard's milestone pattern on path data; like the
 * `d` attributes it would have, it lives here under the Icon.tsx
 * allowlist entry, never rendered as text.)
 */
export const PERSON_SVG_INNER =
  '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>';
export const SPARK_SVG_INNER =
  '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"/>';
/** Raw inner-SVG markup for the comment bubble (issue #302: the glyph on
 * collapsed-thread marks). Tabler 24-grid path data for `message`. */
export const COMMENT_SVG_INNER =
  '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"/>';

export type IconName = keyof typeof COMPONENTS;

export function Icon({ name }: { name: IconName }): JSX.Element {
  const Tabler = COMPONENTS[name];
  return <Tabler size={16} stroke={1.75} className="ic" aria-hidden="true" />;
}
