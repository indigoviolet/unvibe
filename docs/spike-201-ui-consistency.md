# Spike #201: UI consistency — scales, shared components, Settings + start page

Branch: `spike/201-ui-consistency` (never merges). Screenshots: `spikes/201/before/` and `spikes/201/after/` (60 each: start page + 9 settings tabs × Default/Studio/Console × light/dark), captured by `packages/web/e2e/spike-201.spec.ts` against the real service (demo data only).

## What was built

- **Scales** in `packages/web/src/styles/prototype.css` next to the theme variables: `--space-1..8`, `--control-sm/md/lg`, `--radius-control/card`, `--text-xs..xl`, `--weight-normal..bold`, `--text-primary/secondary/muted/disabled`, `--focus-ring`. All three themes fill them in light; dark inherits through `color-mix` on `--ink`/`--bg` so the greys track each theme's dark palette. Default changed visually only where #201 asked: top-aligned field labels, one card radius, muted proportional metadata on list rows.
- **Shared components** in `packages/web/src/ui/` (`index.tsx` + `ui.css`), styled only through the variables: `Button` (primary/secondary/quiet/danger × sm/md/lg), `Field` (label/control/help/status grid, top-aligned labels), `Section`, `Card` (the one card treatment, also re-pointing the legacy `.card`), `ListRow` (primary + muted secondary meta, separators, hover), `Badge` (fixed 72px grid column in Environment, so it no longer moves with title length), `Checkbox`, `Switch`, `Select`, `Input`, `UiTabs`, plus `humanDuration` and `shortStatus` helpers. Focus ring is `var(--accent)` everywhere via `--focus-ring`; placeholders use the theme sans.
- **Migration:** all nine Settings tabs and the start page's PR list. Buttons/cards/selects now use the shared classes/components; Models uses one card treatment per role; Environment is a fixed label/badge/summary grid; Repos rows get separators/hover; Limits gets a section card with top-aligned labels.
- **Copy fixes:** one "Effort" label for every role (was the provider's varying label); effort options no longer repeat values ("Medium (medium)" → name only); Limits shows human units ("Currently 5 min" for `cacheLifetimeMs`, label no longer carries "(ms)"); status strings shortened via `shortStatus` (full text stays in `title`/Doctor).

## Library: what Base UI brought vs plain components

Used **`@base-ui/react` 1.9.0** (the current package; `@base-ui-components/react` is its old name). Base UI supplies behaviour only — keyboard, focus, ARIA, portal/floating positioning — with no styling, which fits "our own CSS on our variables" and avoids a styled kit.

- Worth it: `Checkbox`, `Switch`, `Tabs`, `Button` — correct keyboard/ARIA/state attributes (`data-checked`, `data-selected`) for a few lines each, and the CSS hooks onto those attributes instead of re-implementing state.
- Not used: Base UI `Select`. Its popup listbox would replace the native `<select>` that the settings specs and real users' autofill expect, and styling/positioning the popup is the bulk of the work anyway. The spike keeps a native select styled through the scales. For the real pass, revisit only if custom option rendering is wanted.
- Plain React + CSS was enough for `Field`, `Section`, `Card`, `ListRow`, `Badge` — they are layout, not behaviour; a library adds nothing there.

## Bundle delta

`vite build` main chunk, before (main-rc) vs after:

| | raw | gzip |
|---|---|---|
| Before | 909.42 kB | 270.97 kB |
| After (settings/start) | 917.68 kB | 274.13 kB |
| After (with card addendum) | 931.88 kB | 280.00 kB |
| Total delta | +22.46 kB | +9.03 kB |

That is Base UI's Button/Checkbox/Switch/Tabs, `@floating-ui/dom` for tooltips, plus the new CSS. Acceptable; tree-shaking keeps unused parts out.

## What was awkward

- The existing `.tabs`/`.tab`, `.btn`, `.card`, `.setgrid` classes are load-bearing across the review page, so the spike re-points them at the scales instead of deleting them; a real pass must migrate call sites before removing the legacy names.
- Settings specs assert on native `<select>` and button text, which is why Select stayed native and Button keeps rendering a real `<button>`.
- Full-page screenshots of long tabs (Models, Prompts) are tall; alignment/focus checks are easier at component level in the tour.

## Recommendation for doing it for real

1. Adopt the scales and `src/ui/` as-is; migrate the review page's toolbars, menus and popovers next, moving hand-positioned popovers (tooltip, hover popover, selection toolbar) to Floating UI (Base UI already bundles `@floating-ui/react` positioning) so clamping/flipping is not hand-rolled.
2. Keep Select native unless custom rendering is required.
3. Delete legacy `.btn/.mini/.card/.setgrid` only after the review page migrates.
4. Add one journey per migrated screen against the real service, per repo rules, and extend the visual tour scenes for the review toolbars.

## Verified

- `mise run build`, `mise run typecheck`, `mise run lint` — pass.
- `mise run test:e2e -- e2e/settings.spec.ts e2e/start.spec.ts` — 40 passed.
- `mise run test:e2e -- e2e/journeys/j5-settings-versions.spec.ts e2e/journeys/j11-settings-combos.spec.ts` — 2 passed.
- `mise run visual-tour` — 8 passed. Spike spec: 6 passed, 60 before + 60 after screenshots; inspected Models (labels top-aligned, one Effort label), Environment dark (badges in a fixed column, contrast holds), Console dark start (separators, muted meta).
- Full gate not run (spike; targeted tests only, per brief).

## Addendum (owner, 2026-10-20): card surfaces, tooltips, resize bounds

Screenshots: `spikes/201/before-card/` and `spikes/201/after-card/` (12 each: card element + hovered-tooltip page, per theme × light/dark), from `packages/web/e2e/spike-201-card.spec.ts` on the demo review only.

1. **One card surface variable set.** `--card-surface`, `--card-child-surface`, `--card-header-surface`, `--card-reply-surface`, `--card-input-surface` are defined once (aliases of `--surface`/`--bg-child`, so every theme fills them through its existing variables). `.card`, `.card.child`, the floating card's sticky header (`.exp-h`) and sticky reply area (`.composer` + its textarea) all read from that set. Before, Studio's header and reply were hard-coded `var(--surface)` (white) on the tinted child surface — three stacked boxes plus a white right-edge sliver. After, Studio light and dark cards are one continuous surface (verified in the card screenshots); Default and Console are unchanged in colour because their child surface already matched.
2. **Card toolbar tooltips.** `Tooltip.tsx` now positions with Floating UI (`computePosition` + `offset(6)` + `flip` + `shift`, `@floating-ui/dom`), replacing hand-rolled clamping. When a card toolbar tip's top placement would overlap the card header (`.exp-h`), it is placed below the button instead. Before: the "Use examples" tip covered the quoted header text. After: it sits below the toolbar, header fully visible (see `studio-light-tooltip.png` before/after). This validates the Floating UI direction recommended above for the review page's remaining popovers.
3. **Textarea resize bounds.** Handles are kept. All textareas get `min-width: 120px; max-width: 100%; min-height: 40px; max-height: 320px`; composer/reply boxes tighten to `min-height: 44px; max-height: 240px` and comment textareas to `max-height: 240px`, so a reply box can neither collapse to zero nor be dragged past its card.

Not done: #203 (hiding toolbar/reply while streaming) — filed separately, not part of this spike.

## Review fixes (supervisor round)

- **Limits minutes:** `cacheLifetimeMs` now edits in minutes (`msToMinutes`/`minutesToMs` in `LimitsSection.tsx`, covered by `limitsUnits.test.ts`): the control shows `5`, help is just "Default 5 min.", and save converts back to `300000`. Every other Limits field was checked — `idleExitMinutes` already edits in minutes; the rest are counts/tokens/a ratio, not durations.
- **Environment screenshots:** the spike spec now waits for the checks to render (`[data-testid^="env-"]`) instead of a fixed delay, so before and after both show the fixed badge column.
- **Seeded start page:** the spike harness creates a fixture repo (remote `acme/demo-app`, demo-style data only) with a stubbed `gh` answering `pr list` with three PRs, so the migrated PR list — separators, primary title, proportional muted metadata line — is visible before and after.
- **Studio-dark start:** the PR input uses the themed `.ui-input` surface; "Re-check" is a quiet `Button` in the banner's action row, not orphaned underneath.
- **Models gap:** the Field/setgrid label column is `minmax(140px, max-content)` (was `minmax(180px, 240px)`), so controls sit close to their labels; labels stay top-aligned with the control's first line.
- **Pinned cards (#204 scope):** card surfaces are themed on the pinned card (`.card.child` + its composer textarea from the one variable set). Floating-only surface changes were reverted; the hover peek keeps the ordinary shared popover treatment (`--popover-surface/border/radius/shadow` on `#pop`). The card screenshots now shoot a pinned card with its reply area plus a hovered toolbar tooltip; floating-card frames/shadows/positioning were not pursued. The toolbar-tooltip Floating UI fix applies unchanged to pinned cards.

## Review round 2

- **Path leak scrub:** the spike harness now stubs `d2` (neutral `/tmp/spike201-bin-*/d2`, version `v0.9.0`), so no Environment screenshot shows a home directory, username or hostname; every image was re-inspected (Environment, Repos — fixture under `/tmp` only — Version, Data, Prompts, start, cards). The branch history was rebuilt as fresh commit(s) off `main-rc` and force-pushed, so the leaked images exist in no commit reachable from the branch.
- **gh row:** the harness stub was wrong, not the app — the service calls `gh api user --jq .login` and expects plain text; the stub now answers `--jq` calls with `demo-user`, so the row reads "gh logged in as demo-user".
- **Limits alignment:** the form is one grid and each row a subgrid (`.setgrid-form > .setgrid`), sharing a single label column, so all controls start at the same x; Models (one grid per card) and Access were checked in all themes.
- **Environment actions:** "Doctor page" now uses the same secondary Button variant as Re-check and Reload environment.
