# Pierre diffs evaluation: measured comparison

Evaluation spike for issue #22 ("should the diff pane and file tree be rebuilt
on `@pierre/diffs` and `@pierre/trees`?"). Time-boxed, hands-on: every number
below was measured on 2026-10-11 in this worktree (branch `pierre-spike`), not
guessed. Harness and sources live in `spikes/pierre/`; screenshots in
`spikes/pierre/out/`; raw probe output in `spikes/pierre/out/probe.json`.

## Recommendation

**Keep our diff pane and file tree; add syntax highlighting with Shiki
directly (option 3). Adopt neither Pierre package.**

Why, in one paragraph: our diff pane's core is hunk-level chrome the Pierre
component does not expose — hunk headers with fold/summarize/note/reviewed,
hunk cards independent of folding, hide-uninteresting runs, per-hunk reviewed
state — plus shadow-DOM-hostile features (text selection driving Explain/Ask/
Note, `<mark>` quote highlights, citation reveal+highlight, click-line-number
commenting). Fitting those around `FileDiff`, which owns the whole file's
rendering, means either one `FileDiff` per hunk (5k shadow roots, visual seams,
unbuilt and unmeasured) or re-implementing our chrome against undocumented
shadow internals. The one thing Pierre is genuinely good at — Shiki syntax
highlighting — costs ~87 KB gzip standalone with zero DOM takeover, keeps every
existing behaviour, and needs no CSP change. `@pierre/trees` is a bigger
mismatch still: a full explorer (search, drag-and-drop, rename, git status,
Preact runtime) for a panel whose needs (type chips, +/- and reviewed counts,
Hide reviewed, progress, click-to-scroll) would all be custom code anyway.

**Main risk of the recommendation:** we own highlight integration. Shiki
tokenises whole files/hunks, so multi-line tokens (triple-quoted strings,
fences) must be split across our row boundaries without breaking spans, and
5k-hunk diffs must tokenise lazily inside our existing per-file lazy gate or
first paint regresses. Both are bounded engineering (tokenise per hunk at
reveal time, cache by content hash), not research. Mitigation: prototype on
the fixture + generated large diff in the same harness before touching
`packages/`; gate on measured paint time.

What this rejects and why: adopting `@pierre/diffs` trades ~4 weeks of
rewriting selection, annotations, hunk chrome, reveal, themes and tests for
highlighting plus a virtualiser we don't need (our per-file lazy rendering
already mounts headers-only for 300 files); adopting `@pierre/trees` adds a
beta dependency with a second framework runtime (Preact 11 beta) for a panel
that is ~200 lines of our code with zero open defects.

## 0. Package facts (from the packages, not descriptions)

| Fact | `@pierre/diffs` | `@pierre/trees` |
|---|---|---|
| Current version (npm, 2026-10-11) | **1.5.2** (2026-10-05); 1.6.0-beta.1 in flight | **1.0.0-beta.6** — **pre-1.0/beta**, API unstable |
| Licence (LICENSE.md in tarball + repo root) | **Apache-2.0** ✓ | **Apache-2.0** ✓ |
| Dep licences (transitive, shipped) | MIT (shiki, hast-util-to-html, lru_map, @shikijs/transformers, @pierre/theming), Apache-2.0 (@pierre/theme), BSD-3-Clause (`diff`) — all permissive ✓ | MIT (preact 11 beta, preact-render-to-string), Apache-2.0 (@pierre/theming) ✓ |
| Release cadence | Fast: 1.3.0 → 1.5.2 in ~10 weeks, weekly+ patches; beta channel active | Beta channel only |
| Maintenance signals | 6.3k stars, 228 forks, 1275 commits; 44 open issues incl. two that touch exactly what we need: #405 (React `renderGutterUtility` never created its shadow-DOM slot — **closed, verified fixed in 1.5.2**, slot is created lazily on hover) and #1184 (open: WebKit hard-crash when drag-selecting with `enableGutterUtility` — gutter button re-parented mid-drag; Chromium unaffected) | Same repo; open trees bugs: deeply-nested single-folder rendering (#941), zoom truncation artifacts (#816) |
| API stability | 1.x stable surface; but `unsafeCSS` explicitly "no backwards-compat guarantee, even in patch versions"; token hooks + worker pool + edit marked experimental | **Beta**: expect breaking changes; `FileTreePreparedInput` carries a Symbol key (not serializable, #1109) |
| Peer deps | react ^18.3.1 \|\| ^19.0.0, react-dom same — **compatible with our React 18** ✓ | Same ✓ (but ships its own **Preact 11 beta** runtime regardless) |
| What it ships | React components (`/react`), vanilla classes, web components, SSR (`/ssr`), worker pool (`/worker`), edit-mode `Editor` (`/edit`); Shiki grammars/themes as **lazy JS chunks** (313 assets in our harness build); Oniguruma WASM **base64-inlined** in one 622 KB chunk, loaded only for `preferredHighlighter: 'shiki-wasm'` | React (`/react`), vanilla model, web components, SSR; Preact-based renderer |

## 1. Requirements × verdict table

Cells are measured facts. Verdicts: **works** (out of the box) · **custom**
(works with custom code on documented API) · **internals** (only via
undocumented shadow-DOM selectors/structure) · **no** (not possible / rejected
trade).

| # | Requirement | Verdict | Measured fact |
|---|---|---|---|
| 1a | Unified + split views | **works** | Both render from the same patch; screenshots `theirs-unified-1440-light.png`, `theirs-split-1440-light.png` |
| 1b | Long lines (scroll unified / wrap split) | **works** | Measured computed style: unified `overflow-x: scroll, white-space: pre`; split screenshot shows wrapped line 79 in both halves |
| 1c | Line numbers, +/- gutters | **works** | Present; indicators `bars/classic/none`, inline word diff `word-alt` default |
| 1d | Highlight quality Py/TS/Md/JSON | **works** | Good in all four samples (`theirs-shiki-…` is option 3; Pierre render matches it — compare `theirs-unified-…`) |
| 1e | Theming from our vars (app setting, not OS) | **custom** | `:root` vars inherit into shadow DOM (verified: `--diffs-font-family: IBM Plex Mono` reaches code cells). But code *colors* come from Shiki themes, not our vars: must `registerCustomTheme` light+dark JSON mapping our palette and drive `themeType` from our app setting (`'system'` follows OS only). Pierre's own themes are foreign to our UI |
| 1f | Self-hosted IBM Plex Mono | **works** | Via `--diffs-font-family` (verified computed `IBM Plex Mono`) |
| 2a | Rows under a line (thread + explanation card, live textarea) | **custom** | `lineAnnotations` + `renderAnnotation` (React slot content, normal CSS/state). Verified: 2 threads + card on one line (screenshot), textarea typed text **survives re-render and keeps focus** (`probe.json`: `survived: true, focusedAfter: t1`) |
| 2b | …on new side and deleted lines; several per line; open/closed; both views | **custom** | `side: additions/deletions` verified (`t3` on deletions renders); 2/line verified; close→closed state verified; split verified (`annotations.split: 12`) |
| 2c | Pinned to pane width on sideways scroll | **works** | Annotations are full-width slot rows (screenshot: cards span the pane while code scrolls) |
| 2d | Styling + our CSS classes in annotations | **custom, contained** | Slot content is light DOM: our stylesheet applies to the annotation root, but **nothing crosses into code rows** — quote `<mark>` highlights inside a rendered line are impossible via public API (no sub-line decoration API; upstream feature request #884 open). Closed-thread dotted links and open-thread anchor outlines must be reimplemented (e.g. token hooks) or dropped |
| 3a | Click line number → comment; icon on closed-thread lines; hover tooltip | **custom** | `onLineNumberClick` + `enableGutterUtility`/`renderGutterUtility` both documented and verified (custom `+` button appears on hover, 24×21px, click recorded). BUT: the button exists only on hover (no persistent comment icon — closed threads have no marker without custom code), and the #405-class risk (slot creation) is fixed but the pattern is fragile: slot is created lazily on hover |
| 4 | Selection → Explain/Ask/Note; file+line of selection; quote highlight | **internals** | `document.getSelection()` **does** see shadow text in Chromium and `getComposedRanges()` works (`selection.shadow`: selected `"src/urllib3/"`, 1 composed range). But: our toolbar's host resolution (`closest('#right table.diff td.c')`, row `id="L-…"`) finds nothing in their DOM; word-snapping must be reimplemented against composed ranges; **Safari has no `getComposedRanges`** (needs `shadowRoot.getSelection()`) — **not verified, needs Mac**; re-highlighting the quote needs the missing sub-line API (see 2d). Plus open crash #1184: drag-select + gutter utility **kills WebKit** |
| 5a | `revealSource("diff:<fileKey>:<a>-<b>")`: scroll + highlight, unfolding | **custom/internals** | No per-line scroll API on standalone `FileDiff` — `scrollTo` exists only on `CodeView`. Unfold/unhide is ours to reimplement (their collapse model is `collapsed` per file/item + `expandHunk` on the vanilla instance). Highlight of a range = `selectedLines` (whole lines only). Wiring reveal = adopt `CodeView` (new virtualiser, new scroll container) or query shadow DOM (**internals**) |
| 5b | Hover previews elsewhere (data-driven) | **works** | Unaffected by construction (reads snapshot, not DOM) — confirmed, no work |
| 6 | Hunk chrome (§4.13 core) | **no** (without per-hunk split) | Their component owns the whole file: hunk separators are fixed presets (`line-info/basic/metadata/simple`), no custom rows between hunks, no per-hunk hide/replace/fold/note/summary/reviewed/stale API. Headers are per-*file* slots only. The only path is **one `FileDiff` per hunk** with our chrome around it: unbuilt, unmeasured (5k shadow roots, inter-hunk seams, per-hunk parse cost), and it fights their collapse/expand model. This is the core mismatch |
| 7 | File header (collapse, path, +/-, reviewed, rename/binary/new/deleted) | **custom** | `options.collapsed` + header slots (`renderHeaderPrefix/FilenameSuffix/Metadata`, `renderCustomHeader`) cover collapse/path/counts/badges; `ChangeTypes` covers new/deleted/rename. Reviewed counts + mark-reviewed toggle are custom state (fine — small) |
| 8 | 300-file/5k-hunk perf | **custom** | 300 `FileDiff`s (no virtualiser): first rAF 0.5–22s across runs (variance flagged — Shiki highlight is async, plain text paints first), heap 179 MB, no errors, scroll OK. Their fast path (`CodeView` virtualization + worker pool) was **not adopted in the harness** — it requires restructuring our pane around their scroll container and serving a worker file. Ours mounts ~300 headers + lazy bodies by comparison (no head-to-head large-diff run — stated openly) |
| 9 | CSP + network (hard requirements) | **works** (default engine) | Zero non-local requests; renders fully under our exact CSP (`default-src 'self'; script-src 'self'; …`) with **zero violations** and **zero policy changes** — with `preferredHighlighter: 'shiki-js'` (default). Caveats: `shiki-wasm` (optional) inlines Oniguruma and needs `script-src 'wasm-unsafe-eval'`; worker pool needs `worker-src blob:` + a served worker file; `unsafeCSS` would need no change (`style-src 'unsafe-inline'` already allowed) but carries its own no-compat warning |
| 10 | Bundle size | measured, **3–4× ours for the diff feature** | Ours today: `packages/web/dist` 1.1 MB raw total (JS 599 KB raw / 162 KB gzip). Pierre initial load for the 4-file fixture: **2.5 MB raw / ~400 KB gzip over 28 requests** — core chunk 665 KB raw/196 KB gzip + **15 grammar chunks** (cpp 611 KB raw/44 KB gzip pulled by the single `.rst` file's 52 embedded languages, incl. TS/JS/Python) + 10 theme-variant chunks (~340 KB raw). Trees adds ~250 KB raw (core 665→917 KB: Preact runtime). Full grammar set on disk: 313 assets, 10 MB raw / 2 MB gzip |
| 11 | A11y + keyboard | **works/custom** | Tab reaches annotation textareas (verified); shadow content is exposed to AT as slotted content; our resize handle + Escape are page-level and unaffected. Their internal row semantics (grid, no rowheader roles) not audited — stated openly |
| 12 | `@pierre/trees` vs our files panel | **not worth it** | Renders (screenshot `theirs-trees-search.png`): folders, icons, filter-as-you-type all work — but only after a **sized container** (virtualised; zero-height mount renders nothing, a real integration footgun). Everything our panel needs — type chips with counts, Hide reviewed, reviewed/total + progress, +/- per file, generated tags, click-to-scroll — is custom code on top; row decoration API is thin (`renderRowDecoration`). Pre-1.0 beta + Preact 11 beta runtime for ~200 lines of our code with no open defects |

## 2. Screenshots

Ours: built service, `UNVIBE_AGENT=replay`, demo review (`scripts/shots.mjs`
starts/stops its own service by PID).

| Image | What |
|---|---|
| `out/ours-1440-light.png`, `out/ours-1440-dark.png`, `out/ours-800-light.png` | Our diff pane, 1440 light/dark + 800px |
| `out/ours-pane-600-light.png` | Our source pane (~600px) with hunk card + open threads |
| `out/theirs-unified-1440-light.png`, `out/theirs-unified-1440-dark.png`, `out/theirs-unified-800-light.png` | Pierre unified, light/dark/800px |
| `out/theirs-split-1440-light.png` | Pierre split (equal halves, wrapped longs) |
| `out/theirs-annotations-1440-light.png` | Two threads + explanation cards on line 86, live textareas |
| `out/theirs-trees-search.png` | Trees with filter-as-you-type (`conn`) |
| `out/theirs-shiki-1440-light.png` | Option 3: Shiki tokens in plain rows (Py/TS/Md/JSON, 211 ms) |

## 3. What would rely on undocumented internals

1. Any code reaching into `DIFFS-CONTAINER`'s shadow root (`[data-code]`,
   `[data-column-number]`, `[data-line-index]`, slot names) — selectors the
   `unsafeCSS` warning says may break in any release, even patches.
2. Selection host/line resolution without `getComposedRanges` (Safari path).
3. Scroll-to-line + range highlight without adopting `CodeView`.
4. Sub-line quote `<mark>` highlights (no public API exists at all — #884).
5. Per-hunk fold/replace/hide inside one `FileDiff` (no API; separators are
   string presets, the render-function separator API is being phased out).

## 4. Adoption work estimates

### A. Adopt both (~5 weeks, not recommended)

Delete: `FileSection` row rendering, `lineSlots` registry, `SlotRow`/split
pairing render, our gutter click handling, `SelectionToolbar` host resolution,
anchor `<mark>` pipeline, `revealSource` scroll/highlight, files-panel tree
(`buildFileTree`), most of `diff.spec.ts`/`DiffView.test.tsx`.
Write: per-hunk `FileDiff` splitting + our hunk chrome around each;
annotation bridge (threads/expansions → `lineAnnotations`, draft-state
keying); shadow-aware selection + word snap + Safari fallback; reveal via
`CodeView` + `selectedLines`; custom Shiki theme pair for our palette;
worker-file serving + `worker-src` CSP line; trees panel replacement with
custom counts/chips/progress/click-scroll; full e2e rewrite incl. shadow-DOM
selectors. Tests changed: unit (selection, slots), behaviour (diff, comments,
interaction journeys), network-guard (worker). Carries #1184 (WebKit crash),
beta-trees, and Preact-in-React costs permanently.

### B. Adopt diffs only (~4 weeks, not recommended)

Same as A minus trees (~1 week saved: keep our files panel). Still pays the
core mismatch (§6): per-hunk split or hunk-feature amputation, selection
rewrite, Safari risk, ~400 KB gzip added, grammar-fetch behaviour to tame
(`setLanguageOverride` to `text` for docs/generated, or accept 2.5 MB on a
4-file diff).

### C. Keep ours + Shiki directly (~3–5 days, recommended)

Delete: the `#`-comment heuristic in `FileSection` (one line). Write: a
`highlight.ts` (Shiki core + **JS engine** — no WASM, no CSP change) that
tokenises per hunk at reveal time, splits multi-line tokens at row
boundaries, emits our current `<span>` structure with token colors; a
`registerCustomTheme`-equivalent mapping our light/dark CSS variables to two
static Shiki themes; lazy `import()` so the ~87 KB gzip rides a separate
chunk; per-file lazy gate reuse (tokenise cost inside existing
IntersectionObserver path, cache by content hash). Tests changed: golden
snapshots for Py/TS/Md/JSON tokens, one perf assertion (fixture paint time),
no e2e rewrite. Measured cost: **488 KB raw / 87 KB gzip** bundled for
core+JS-engine+4 langs+1 theme (esbuild, minified); grammars beyond the four
degrade to today's plain rows.

## 5. Could not verify

- Safari behaviour (no Mac here): `getComposedRanges` absence, #1184's crash
  proximity, #413's Safari display bug. Needs `needs-mac` run.
- Head-to-head large-diff paint/scroll against our pane (no 300-file fixture
  in our snapshot format; harness `perf` route is Pierre-only).
- Per-hunk `FileDiff` seams/cost (deliberately unbuilt — the estimate assumes
  the worst).
- `CodeView` virtualiser + worker pool path (docs-only; needs worker serving).
- Their AT/role audit beyond keyboard reachability.
- Whether Pierre theme-variant preload (10 chunks incl. protanopia/soft/
  vibrant) can be trimmed to our two themes (likely, unverified).

## 6. Harness notes

`spikes/pierre/` (own `package.json`, not in npm workspaces, not in the
build): Vite + React 18 + `@pierre/diffs@1.5.2` + `@pierre/trees@1.0.0-beta.6`
+ `shiki@3.7`. Routes: `#/unified #/split #/annotations #/annotations-split
#/perf (300 files/~5.1k hunks) #/trees #/shiki`. Scripts: `gen-fixture.mjs`
(demo patches from `fixtures/urllib3-5020/diff.json`), `shots.mjs` (own
service by PID + static server, kills both), `probe.mjs` → `out/probe.json`.
Two harness bugs found and fixed during the spike (both ours, not Pierre's):
passing `onGutterUtilityClick` + `renderGutterUtility` together throws, and
`//` comments in a `.css` file silently drop the following rule. `node_modules`
removed after the run; sources + screenshots kept.
