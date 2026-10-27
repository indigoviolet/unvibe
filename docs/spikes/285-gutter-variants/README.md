# Spike #285 — gutter width variants (evaluation only, NEVER merged)

Four variants (A–D) of the unified diff gutter, switchable via `?gutter=a|b|c|d`
on the review URL (absent = baseline). The switch is spike-only code —
`packages/web/src/source/diff/gutterVariant.ts` (reader + `window.__setGutterVariant`
live hook), `gutter-variants.css` (all variant styling), and small branches in
`FileSection.tsx` / `FileExpansion.tsx` / `DiffView.tsx` — none of it merges.

The test file is a scratch repo (`src/big.py`, 1300 lines): hunk 1 covers new
lines ~1007–1020 (a changed line, a removed line, two added lines, long line
1015 for sideways scroll), hunk 2 ~1151–1158, with a ~130-line gap between
them (expand controls above hunk 1 and on both sides of the gap). A closed
comment thread puts the comment icon on line 1020; a closed Explain thread
over lines 1007–1009 puts the reopen marker (`↪`, #189) in hunk 1's gutter.
All hunks have 4-digit numbers. Frames: 5 roots × {520, 1440} × {light, dark}
= 20, plus hover (comment icon + tooltip) and sideways-scrolled (sticky)
frames in light at 520.

## Gutter width (px, left edge of row → start of code text; 4-digit lines)

Measured in-page at 1440/light (geometry is identical at 520 and in dark;
narrow pane pinned to 520px, wide pane is the 605px default at a 1440 viewport).

| variant | old col | new col | gutter | Δ vs baseline |
|---|---|---|---|---|
| baseline (today) | 62 | 58 | 127.2 | — |
| A overlay, don't reserve | 36 | 36 | 79.2 | −48.0 (−38%) |
| B A + expand carets leave the number column | 36 | 36 | 79.2 | −48.0 (same as A) |
| C B + `+`/`-` sign column dropped | 36 | 36 | 79.2 | same gutter; ~1ch (~7px) reclaimed *inside* the code cell |
| D single number column | 36 (only) | — | 43.6 | −83.6 (−66%) |

Column floors: baseline old = digits + 16px padding + 18px reopen-marker room,
new = digits + 16px + 14px comment-icon room. Variants: digits + 8px padding
(4px a side), zero affordance room; the comment icon and reopen marker are
absolutely positioned over the cell padding. Sticky offsets follow the floors
(second column `left` 61.6 → 35.6px); `position: sticky` on the number cells is
untouched, and sideways-scroll frames show the numbers frozen at the scroller
edge in every variant (cell edge == scroller edge, 0px drift at 300px scroll).

## Per-variant notes

- **A.** Nothing reserves icon space, so nothing shifts when a comment opens/
  closes or the marker appears (both are `position: absolute` in the
  harness assertions). The price is visible in the `-zoom` crops: the 11px
  icon and the `↪` badge paint over the first ~2 digits of their row's number
  (4px padding can't fit them). Numbers stay legible, but "1007" reads with
  a badge on top.
- **B.** Number columns identical to A; the `^ ⇞ v ⇟` carets move from the
  frozen gutter cell into the separator row's code cell, left of the code.
  Trade-off: the carets are no longer frozen — on a sideways-scrolled hunk
  they scroll away with the code (baseline/A keep them pinned in the
  gutter). A real build could freeze them; the spike doesn't.
- **C.** Same gutter as B; the gain is ~one mono advance of code width.
  **Colour-blind verdict: keep the marker.** In the default theme the row
  tint is the *only* remaining add/del cue (`--diff-edge-*: none` — there is
  no coloured bar in this theme), and it fails WCAG non-text contrast (3:1)
  decisively: add-tint vs surface 1.14, del-tint vs surface 1.16 (light;
  1.19/1.11 dark), add-tint vs del-tint **1.02** (light) / **1.07** (dark) —
  the two tints are luminometrically identical, and the red/green pair is
  the classic protan/deutan confusion axis. Studio/console themes do have a
  2px inset bar that passes (4.7–7.5:1), but hue-only add-vs-del distinction
  still leans on red vs green. If C is picked, it needs a non-hue cue.
- **D.** Tightest (43.6px, −66%). Shows the new number; deleted lines show
  their old number; the tooltip names the old number where they differ
  ("Comment on line 1020 (was 1019)"). Trade-offs: the same row can show the
  same digit twice in a row (here two "1012" rows: removed old 1012, then
  context new 1012); old numbers require hover; blame-style old-line reading
  is gone. Single column keeps sticky + comment-on-line working.

Must-holds verified in the harness for every variant: comment icon and
reopen marker are out-of-flow overlays (computed `position: absolute`;
baseline: `static`), sticky offsets track the tightened floors, 300px
sideways scroll leaves number cells exactly at the scroller edge, and
clicking a plain new-side number opens the comment composer in all five
roots (`validate` test).

## Frames

`{baseline,a,b,c,d}-{520,1440}-{light,dark}.png` (20) · `{baseline,a,b,c,d}-hover-520-light.png` and `{baseline,a,b,c,d}-scroll-520-light.png` (10) · `{baseline,a,b,c,d}-zoom-520-light.png` (5 gutter close-ups, generated from the 520-light frames).
