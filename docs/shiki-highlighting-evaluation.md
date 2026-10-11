# Shiki highlighting evaluation (issue #23)

Spike branch: `spike/shiki-highlighting` (never merges to `main`).
Prototype + harness + screenshots + this write-up all stay on the branch.

**Recommendation: adopt with these changes** (listed in §9). The prototype
proves the approach keeps every diff-pane behaviour with ~2 KB gzip added
eagerly, no CSP change, and no first-paint regression; the remaining work is
bounded hardening, not research. Main risk: highlight integration
performance on very large diffs (§6) — bounded by the existing lazy gate,
but the worst frame roughly doubles on a full 5k-hunk catch-up scroll.

## 1. What was built

Syntax highlighting directly in the real diff pane (`packages/web`), no new
rendering library, no DOM takeover. Rows render plain text on first paint,
then upgrade to token colours when Shiki is ready.

- **Engine**: `createHighlighterCore` from `shiki/core` + the JavaScript
  regex engine from `shiki/engine/javascript`. No WASM (so no
  `wasm-unsafe-eval`), no workers, no CDN. Everything is bundled and served
  from our own origin.
- **Loading**: the Shiki core, the engine, and every grammar are lazy
  `import()` chunks. The initial bundle grows by ~2 KB gzip (our modules +
  CSS only). The first visible hunk pulls core + engine + its grammar on
  demand; nothing for a language ships until a visible hunk needs it.
- **Tokenising**: per hunk, old side (`del`+`ctx`) and new side
  (`add`+`ctx`) are tokenised as separate sequences with grammar state
  carried across their lines. Unified rows show new-side tokens (the
  post-image under review); deleted rows show old-side tokens; split cells
  show their own side. Context lines therefore have one token row per side,
  which may differ when the sides' states diverge (by design — each side is
  coloured as its own file state).
- **Theme**: one CSS-variables theme (`unvibe`, prefix `--shk-`). Shiki
  emits `var(--shk-token-…)` colours, which `tokenize.ts` maps to `shk-*`
  classes; `highlight.css` defines the palette from the app's own
  light/dark variables (explicit `data-theme` wins, else OS — mirroring
  `prototype.css`). Theme switches are pure CSS, never re-tokenise. Plain
  runs stay spanless, so copy-paste yields plain text with no artefacts.
- **Gating**: tokenising hooks into the existing per-file lazy gate
  (`FileSection`'s IntersectionObserver): headers mount first as today;
  only rendered (visible, unfolded, unhidden, non-binary) hunks tokenise.
  Hidden hunks tokenise on unhide (cache or on demand). Tokens cache by
  `lang:contentHash`, so WebSocket re-renders never recompute (unit-tested
  object identity + e2e cache stats, §6).
- **Caps**: lines over 2000 chars render plain; sides over 100k chars skip
  the hunk. Binary files never reach us (no rows). Unknown languages
  render today's plain rows (including the `#`-comment heuristic, which is
  dropped only where real tokens exist).
- **Anchor integration**: token spans arrive after first paint and React
  replaces the cell's text nodes, wiping DOM `<mark>`s — so the expansion
  quote-marking effect (`DiffExpansions`) re-runs on highlight completion
  (subscription, additive). Quotes spanning several token spans resolve via
  the existing joined-text-node lookup; idempotence (issue #15) holds
  (no nesting verified in e2e).
- **Hover previews** of cited lines elsewhere stay plain text: they are
  1–4 line snippets resolved from the snapshot (not the DOM), and
  highlighting them would pull the lazy loader into popovers for no
  readability gain.
- **`?nohl=1`** disables highlighting (before-screenshots + deterministic
  plain-paint tests). Spike-scoped; adoption decides whether to keep it.

Files (prototype; adoption would redo deliberately):

| File | What |
|---|---|
| `packages/web/src/source/diff/highlight/language.ts` | extension/filename → Shiki lang, lazy importers, shipped set |
| `packages/web/src/source/diff/highlight/tokenize.ts` | pure side-splitting, colour→class map, caps, alignment |
| `packages/web/src/source/diff/highlight/shiki.ts` | lazy core/engine/lang loading, hunk cache, completion events |
| `packages/web/src/source/diff/highlight/useFileHighlight.ts` | plain-first hook on the file lazy gate |
| `packages/web/src/source/diff/highlight/highlight.css` | token palette, light + dark |
| `packages/web/src/source/diff/FileSection.tsx` | render token spans (unified + split), injectable rows for tests |
| `packages/web/src/guide/expansions/DiffExpansions.tsx` | re-mark quotes when tokens land |
| `scripts/release.mjs` | also read lowercase `license` files (Shiki transitives) |
| tests | `highlight/*.test.ts(x)` (language, tokenize, real-Shiki goldens incl. wrong-colour cases, render), `e2e/shiki-highlight.spec.ts`, `e2e/interaction-none-service.spec.ts` selection helper hardened for split text nodes |

Harness + evidence: `spikes/shiki/` (`scripts/lib.mjs`, `perf.mjs`,
`shots.mjs`, `wrongcolor.mjs`, `out/`).

## 2. Size

Vite build, measured raw + gzip (python `gzip.compress`, level 9):

| Asset | Raw | Gzip | Notes |
|---|---|---|---|
| `index.js` eager delta | +7.2 KB | **+2.8 KB** | our modules + hook; core/grammars all lazy |
| `index.css` delta | +0.9 KB | +0.2 KB | `highlight.css` |
| `core-*.js` (lazy) | 116.1 KB | 37.0 KB | Shiki core + textmate |
| `engine-javascript-*.js` (lazy) | 61.1 KB | 21.4 KB | JS regex engine, no WASM |
| per language (lazy) | — | py 9.1, ts 16.0, tsx 16.5, js 16.5, jsx 16.6, md 5.6, html 11.7, css 12.4, sh 6.1, yaml 2.3, toml 1.3, json 0.8, jsonc 0.8 | one chunk each |
| theme | 0 | 0 | CSS-variables theme is code, no theme chunk |

Baseline (pre-spike): `index.js` 611 KB raw / 164.6 KB gzip, dist 1.1 MB
(fonts dominate both). With the prototype: eager **+2.8 KB gzip**; first
highlight of Python pulls ~67 KB gzip (core + engine + grammar), further
languages ~1–17 KB each.

Pierre comparison (their §10 / §4C): they measured **~87 KB gzip for
core + JS-engine + 4 langs + 1 theme** (esbuild). Ours for the equivalent
set (core 37.0 + engine 21.4 + py 9.1 + ts 16.0 + md 5.6 + json 0.8, css-vars
theme = 0): **~90 KB gzip** (vite). Verified: same ballpark, and our eager
cost is ~3 KB vs their ~400 KB initial load for the Pierre component.

Per-language notes: ts/tsx/js/jsx are each ~16 KB gzip with little sharing
(self-contained TextMate grammars) — a TS+TSX diff loads both (~32 KB).
Markdown is cheap (5.6 KB) and does NOT pull embedded code-language
grammars (fenced blocks get markdown colours, inner code stays plain —
accepted degradation, avoids the 611 KB cpp pull the Pierre harness hit via
`.rst`). `.rst` is deliberately unshipped (plain).

Default ship set: python, typescript, javascript, tsx, jsx, json, jsonc,
markdown, bash (shellscript), yaml, css, html, toml. Everything else
(incl. rst, Go, Rust, Java, C/C++) degrades to today's plain rows.

## 3. Tokenising diffs: hunk-only vs full-file

Chosen: **hunk-only** (no extra API call). Each side's lines are joined and
tokenised with state carried across the hunk — intra-hunk multi-line
constructs colour correctly. What breaks: constructs opened *before* the
hunk (or closed differently per side).

Concrete wrong-colour cases (pinned by `shiki.test.ts` goldens and
`scripts/wrongcolor.mjs`, which diffs hunk-only vs full-file colours):

1. Python triple-quoted string/docstring opened before the hunk: inside
   lines colour as code, not string (1/3 rows diverge in the probe).
2. Same for triple-quoted assignment spanning the hunk.
3. TypeScript block comment spanning the hunk: inside lines colour as code.
4. TypeScript template literal spanning the hunk: inside lines lose string
   colour.
5. Old/new divergence is handled per side (a `ctx` tail after a del-run
   that opened a string colours string on the old side, code on the new —
   unit-tested).

Frequency on real diffs: the demo fixture (urllib3#5020, 8 hunks) has **0
hunks with unbalanced multi-line delimiters** (language-aware scan in
`wrongcolor.mjs`; the one naive flag was a backtick inside a Python regex
character class — not a construct). Estimate: a hunk goes wrong only when a
hunk boundary falls inside a multi-line string/comment/template — rare in
typical diffs (docstrings usually arrive as `+` lines, fully inside the
hunk, which colours correctly), and the failure mode is *wrong colours*,
never broken rows.

Full-file state (fetch worktree content per file) was rejected: it needs a
new API + version-staleness story, the worktree may not exist (demo), and
it ships whole files to the renderer for a cosmetic gain on rare hunks.
If adoption wants it later, the seam is `highlightHunk` (pass optional
prefix state); no render changes needed.

## 4. What broke and how it was fixed

1. **E2E selection helper assumed single text nodes**
   (`interaction-none-service.spec.ts`): with token spans, the sought
   substring can span nodes, and a whole-table join can even match across
   the line-number/code boundary (found during debugging: the range
   anchored in `td.n`, so host resolution correctly refused it). Fixed the
   helper to search per `td.c` with boundary offsets preferring the next
   node. Same hardening applied to the new spec's helper. App code was
   correct; the tests were single-node-naive.
2. **Release notices staleness guard** (`release-notices.test.ts`): Shiki
   transitives (`hast-util-*`, `mdast-util-*`) ship lowercase `license`
   files, which `readWebLicenseText` ignored. Extended the candidates in
   `scripts/release.mjs`. All bundled licences remain permissive
   (MIT/Apache-2.0/BSD/OFL/ISC); no new licence texts required beyond the
   generated MIT section.
3. **Anchor `<mark>`s wiped by token upgrades**: solved via the
   completion subscription (§1); e2e asserts one id per quote and zero
   nesting after tokens + marks land in either order.
4. **No other breakages**: the full e2e suite (112 tests incl. 6 new)
   passes with highlighting on — fold/hide/reviewed/split/selection/
   threads/expansions/reveal all run against highlighted rows.

## 5. Performance

Measured 2026-10-11 in this worktree (Chromium headless, `perf.mjs` →
`out/perf.json`). Before = `?nohl=1` on the same build.

| Measurement | Before | After |
|---|---|---|
| Demo TTFP (headers visible, median of 3) | 384 ms | 361 ms (unchanged, noise) |
| Demo time-to-highlighted (first token span) | — | ~600 ms (incl. lazy core+grammar load) |
| Demo eager-region settle (238 spans, 5 hunks) | — | ~1.3 s |
| Demo scroll long-tasks (full pane) | 0 | 0 |
| Demo heap after settle | 15.4 MB | 20.7 MB (+5.3 MB) |
| Re-render (Hide×2): spans / cache | 238 / 5 hunks | 238, cache grows only for newly unhidden hunks (on-demand by design) |
| Multi-lang ingest (7 files) | — | 116 ms |
| Multi-lang spans/file | — | py 52, ts 55, tsx 46, md 9, json 13, sh 17, rst 0 (plain by design) |
| Large ingest (300 files / 5100 hunks) | — | 442 ms |
| Large header mount (300 headers) | — | ~600 ms; only 3 tables mount (lazy gate intact) |
| Large visible-region highlight | — | ~15 ms (warmed chunks) |
| Large full-scroll long-tasks | 364 tasks / 31.5 s total / 240 ms max | **428 tasks / 47.4 s / 470 ms max** |
| Large heap | 16.3 MB | 20.7 MB (+4.4 MB) |
| PATCH mark-reviewed round trip (tokens cached) | — | ~1.6 s incl. 1.5 s test wait; spans intact (833 on fresh page) |

Reading: first paint is unchanged (plain rows); highlighting settles in
~1 s on the demo. The 5k-hunk full-scroll worst case janks *with or
without* highlight (364 long tasks plain — the 5k-row DOM dominates);
highlight adds ~18% more tasks, ~50% more long-task time, ~2× worst frame
(240 → 470 ms) while it tokenises every file on catch-up scroll. Normal
use (incremental reveal) pays per-file cost only. Cache identity is
unit-tested (no recompute on re-render).

## 6. Security policy and network

- `packages/service/src/security/csp.ts`: **unchanged**. No WASM (no
  `wasm-unsafe-eval`), no workers (no `worker-src`), no remote fetches
  (no `connect-src` change), token colours are classes + CSS variables
  (inline `style=` never used for tokens; `style-src 'unsafe-inline'`
  untouched).
- Full e2e suite green, which includes the network-guard fixture (fails on
  any non-local request) and the dedicated network-privacy walk (zero
  non-local requests, zero CSP violations asserted explicitly) — both run
  with highlighting on.
- Static guards (`network-guards.test.ts`, `subprocess-allowlist`) pass
  under `mise run check`.

## 7. Test results

- `mise run check` (lint + typecheck + unit): green, 163 web tests
  (20 new: language, tokenize, real-Shiki goldens, render incl. live
  hook) + service suite incl. release-notices.
- `mise run build`: green; per-chunk table in §2.
- `mise run test:e2e`: **112/112 pass** with highlighting on (incl. 6 new
  shiki tests). One failure on the first full run
  (`interaction-none-service` selection helper) was caused by the
  single-node assumption (§4.1) and fixed; the final full run is green,
  including the network-guard fixture (fails on any non-local request)
  and the network-privacy walk (zero non-local requests, zero CSP
  violations asserted explicitly).
- New Playwright spec `e2e/shiki-highlight.spec.ts` (6 tests): highlight
  presence per language + rst-plain, `?nohl=1` plain state, selection
  across token spans → Ask composer with the multi-node quote, Explain →
  Close → flat dotted mark + re-expand, reveal + tokens coexisting
  (unified and split), artefact-free copy text.

## 8. Screenshots

Under `spikes/shiki/out/` (diff-pane clip `#right`; `before-*` = `?nohl=1`):

| Shot | Content |
|---|---|
| `after/before-unified-1440-light-{app-py,index-ts,widget-tsx,README-md,config-json,run-sh,notes-rst}` | per-language before/after, unified, light, 1440px |
| `after/before-unified-1440-dark-app-py` | dark theme, unified |
| `after/before-split-1440-light-app-py`, `after-split-1440-dark-widget-tsx` | split view |
| `after/before-unified-800-light-app-py`, `after-unified-800-dark-index-ts` | 800px window |

## 9. Adopt with these changes

1. **Perf guardrail**: keep the lazy gate + cache + caps as built; consider
   `manualChunks` sharing for ts/tsx/js/jsx (~16 KB each, mostly
   duplicated) and a long-task budget assertion on the demo scroll.
2. **Keep `?nohl=1`** (or a real setting) as the escape hatch + plain-mail
   path; decide whether hover previews ever highlight (recommendation:
   keep plain).
3. **Full-file grammar state**: defer (see §3); revisit only if wrong-colour
   reports arrive.
4. **Safari + low-end hardware**: not verified here (no Mac, no throttling
   run) — needs `needs-mac` + a Moto-G-class pass (JS engine is slower
   than WASM on huge files; caps bound it, but measure).
5. **Selection mid-upgrade**: a selection active exactly when tokens land
   can lose its range (React swaps text nodes). Rare (once per hunk);
   adoption could defer upgrades while `!getSelection().isCollapsed`.
6. Carry the `release.mjs` lowercase-licence fix and the e2e helper
   hardening (both already on this branch).

## 10. Could not verify

- Safari (no Mac): selection/anchor paths use standard Range APIs, but
  untested; the Pierre eval's Safari items (#1184, #413) are Pierre-only
  and do not apply here (no shadow DOM, no Pierre code).
- Low-end hardware / throttled CPU: caps bound worst cases, unmeasured.
- Whether `tsx`/`jsx` grammars justify separate chunks vs one shared chunk
  (adopt-time bundling detail).
