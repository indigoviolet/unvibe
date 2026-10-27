# #286 evaluation: re-test the excluded D2 features

Spike branch: `spike/d2-features` (base `main-rc` 04e2cd8; evaluation only, never merges).
Pinned d2: **v0.9.0**. All rendering offline, hand-written samples on the bundled
demo subject (public urllib3 obs-fold change). **No live run, no tokens spent.**

Method: `spikes/d2-features/harness/harness.ts` renders every `samples/*.d2`
through the REAL pipeline pieces — `precheckD2Source` → `renderD2Theme`
(light 0 + dark 200, identical flags, sandboxed env) → `postProcessSvg` —
and records bytes, wall ms, surviving `data-refs` cites, external hrefs and
`foreignObject`. `mechanism.ts` re-runs the banned-but-liftable features raw
with the identical flags (exactly what a lifted pre-check would compile) plus
the real post-processor. `icon-demo.ts` runs the allowlisted-icon path end to
end. `shots.mjs` screenshots the post-processed SVGs inside the app's real
`.dg-d2` stylesheet for Default/Studio × light/dark (63 shots in `out/shots/`;
representative ones viewed). Basis for the rules below: the two owner
decisions on #286 — only three defences remain
**(1) imports off, (2) icons only from the allowlisted host, (3) the
post-render link sanitiser** — everything else is guidance + render quality.

## Per-feature table

`Renders` = through the real pipeline (light+dark, 4 app themes checked on
screenshots unless noted). `Reliability` = TBD until the live run for every row.

| Feature | Renders | Why banned (history) | Useful, concretely | Cites survive | What it needs to render well | Guidance needed | Recommendation |
|---|---|---|---|---|---|---|---|
| `icon:` allowlisted host | YES (demoed end to end, icon visible in all 4 themes) | Security: `icon:` fetches URLs at view time (docs §Defences; confirmed: `--bundle=false` emits remote `<image href>` unfetched) | Warn/decorate a shape, e.g. archive-box on the long-header node | YES (both cites) | Pre-fetch allowlisted bytes ourselves (5 s cap) → stage → rewrite to local path → d2 embeds `data:` even with `--bundle=false` → sanitiser keeps `<image>` **iff** `href` is `data:image/*` (3-line change each in `sanitize.ts` + web `d2sanitize.ts`); reject non-allowlisted pre-compile; strip-on-404 | Convention lists 8–10 verbatim icon paths + the exact `icon: https://icons.terrastruct.com/<path>` form (`%2F`-escaped, no `?`/`#`); invented names 404 (measured 12/12 miss below) | TBD | ALLOW with the three-rule mechanism |
| `icon:` other hosts | Rejected pre-compile (by rule) | Same as above | — | — | The host check (exact `icons.terrastruct.com`, https, no query/fragment) | One rule line + example | TBD (negatives) | KEEP REJECTING |
| `shape: image` | Same treatment as `icon:` (d2 embeds local `src` as `data:` the same way; verified raw) | Security: fetches `src:` URLs | Before/after screenshots of rendered output, architecture photos | YES (same anchor path) | Same mechanism, `src:` validated identically | Same as icon | TBD | ALLOW, same mechanism |
| imports (`...@`, `@file`, `: @…`) | NO — still rejected | Security: reads arbitrary local files, no flag disables it | None in our setting | — | Nothing (stays banned) | Keep the one rule line | — | KEEP BANNED (defence #1) |
| markdown labels (`\|md`) | YES — renders, external link stripped, `foreignObject` dropped by sanitiser, cites intact (screenshot verified) | Reliability framing at the time: md links become real external links | Rich labels: `# heading`, inline code, bold key terms | YES (both cites) | Nothing but lifting the pre-check line; sanitiser already strips the links | "Links in md labels are stripped; don't rely on them. Cites still go in `{link:}`" | TBD | ALLOW |
| LaTeX labels (`\|latex`) | YES — renders as math, cites intact (screenshot: `x² + OWS → space`) | Same bucket as md | Regex/algorithm key lines (`OWS CRLF RWS → space`) | YES | Lift pre-check line only | Example only | TBD | ALLOW |
| code labels (`\|lang`) | YES, already passes today's pre-check; renders as code chip with cite | Never banned (block-string form `:\|` is, and stays risky) | Key line of the diff as the node label | YES | Nothing | One example | TBD | ALLOW, document |
| `vars:` | YES raw (renders, cites intact) | Resource/smuggling caution | Palette/constant reuse across a diagram | YES | Lift pre-check line only | Example (`vars:` + `${}`) | TBD | ALLOW |
| `d2-config:` | YES raw (renders; `theme: 0` in source is overridden per-render by our `--theme` flag anyway) | Same bucket | Almost no value (our flags already fix layout/pad/theme) | YES | Lift pre-check line only (or keep rejecting — harmless either way) | "Don't set theme/layout; the pipeline does" | TBD | ALLOW but discourage |
| `classes:` stanzas | YES raw (benign `style.fill` applies; remote `style.font` **fails closed in d2**: `"..." is not a valid font in our system`) | Feared font smuggling; probe shows d2 itself refuses non-system fonts | Named state buckets (`hot: {style.fill}` + `shape.class: [hot]`) as an alternative to ok/bad | YES | Lift pre-check line only | Example; note fonts fail closed | TBD | ALLOW |
| `tooltip:` | YES raw → native `<title>`, kept by pipeline when it carries no token (screenshot shows badge + hover text) | Fights the rich hover preview | Short plain-English gloss on a shape | YES (alongside) | Lift pre-check line only; `stripTokenTitles` already kills token-carrying titles | "Keep it short; never put a citation in tooltip text" | TBD | ALLOW |
| `layers`/`scenarios` | Render to a directory only (`multiboard output cannot be written to stdout`); one SVG per board (`before`, `after`), cites intact per board | Viewer: our viewer shows one SVG, no board UI | Before/after, OS variants, fast/slow path | YES per board | Viewer work (see §Boards below); pipeline: compile to temp dir, cache per board | Board naming + one-board-per-idea | TBD | ALLOW once viewer shows boards |
| `steps` + animation | Single animated SVG via `--animate-interval` to a **file** (in-source `animate-interval:` is NOT a d2 keyword — it renders as a stray shape labelled with the ms value; evidence in shots) | Same viewer gap | Request lifecycle, before→after transitions | YES (all 3 cites in animated SVG) | Pipeline: `--animate-interval` + file output when boards present; viewer: plays as-is (CSS), needs 1-rule reduced-motion guard | "Steps only; animation comes from the flag; keep ≤4 boards" | TBD | ALLOW once viewer plays it (cheap) |
| containers / nesting | YES, incl. 4 themes (screenshot) | Never taught | Module/process boundaries (`parser: {msg, norm}`) | YES inside | Nothing | One example | TBD | TEACH |
| edge styles (dash/width) | YES — redeclare edge `a -> b: {style: {...}}` after its label line (`stroke-dash: 0–10`, `stroke-width`) | Never taught | Optional vs required flow, emphasis | YES | Nothing | Exact two-line pattern (inline `{link:; style:}` does NOT compile) | TBD | TEACH |
| arrowheads | YES — `a -> b: {target-arrowhead: {shape: diamond}}` (NOT inside `style:` — that fails) | Never taught | Decision/branching edges | YES | Nothing | Exact pattern (the `style.` placement is the trap) | TBD | TEACH |
| `grid-rows/columns` | YES (screenshot: before/after side by side, both cited) | Never taught | Before/after, option comparisons | YES | Nothing | One example | TBD | TEACH |
| `sql_table` | YES both themes (screenshot) | Never taught | Schema changes | **NO on rows** — d2 silently drops `link:` on table rows AND class fields (verified with `constraint:` combo too); cite the table shape, not rows | Nothing (renders fine) | "Cites go on the table, never on rows/fields" + shape-level example | TBD | TEACH with the row-cite warning |
| `class` | YES both themes | Never taught | Type/interface changes | **NO on fields/methods** (same silent drop) | Nothing | "Cites go on the class, never on members" | TBD | TEACH with the member-cite warning |
| full shape catalogue (rect/square/page/parallelogram/document/cylinder/queue/package/step/callout/stored_data/person/diamond/oval/circle/hexagon/cloud/text) | YES all 18, 4 themes spot-checked (screenshots) | Never taught | cylinder = datastore, diamond = branch, queue = retry/buffer, person = maintainer/on-call, cloud = network, callout = see-also, page/document = log/message, `text` = plain note | YES | Nothing | Meaning table + 2–3 examples (full catalogue in convention would bloat it) | TBD | TEACH the mapping |
| sequence: spans | YES (activation bars render; screenshot) | Only `shape: sequence_diagram` was taught | Hold/re-entrant parse spans | YES on messages | Nothing | `a -> a.t: label` pattern | TBD | TEACH |
| sequence: self-message | YES with cite (screenshot) | Not taught | Collapse/normalise loop on one participant | YES | Nothing | One example | TBD | TEACH |
| sequence: notes | `p.note: "text"` renders a document callout on the lifeline. Bare `note:` / `note over a, b:` (mermaid syntax) **silently becomes an extra participant** — the trap to document | Not taught | "folded Set-Cookie arrives" context | Notes carry no link field; cite the adjacent message | Nothing | Exact `p.note:` form + never-bare-note warning | TBD | TEACH the one form, BAN the bare form in guidance |
| sequence: groups | No true fragments in v0.9.0; `group "x" {}` prints the word "group" in the label. A labeled container (`name: {label: "unfold" ...}`) nests correctly in sequences (screenshot) | Not taught | Unfold phase grouping | YES inside | Nothing | Container-with-label pattern | TBD | TEACH the container pattern |
| sequence: links on messages/spans | YES inline (`a -> b: label {link:}`); dedented `link:` lines are silently dropped (known, pipeline already repairs) | Known pitfall | Every message citeable | YES inline only | Existing silent-drop check already covers | Keep the inline rule (already in convention) | 15/16 → 16/16 in prior run | KEEP + TEACH spans |
| `style.animated` edges | YES through today's pipeline — `@keyframes dashdraw` survives service + web passes; static screenshot shows dashes, animation confirmed in SVG | Not taught | Flowing data edges | YES (same-map `{link + style}` block form) | **Reduced-motion guard** (one viewer CSS rule; d2 emits no `prefers-reduced-motion` query) + note the web `@keyframes` scoping pass-through (names are salt-unique) | Block-map form only (two separate maps do NOT compile) | TBD | TEACH with the block-map pattern |
| meaningful styling (stroke/fill) | YES raw hex works, but **ignores app themes** (screenshots: fixed red/green in dark mode); theme-following styling = `ok`/`bad` classes via `shape.class: [ok]` + the app stylesheet (verified in all 4 themes) | Only ok/bad taught | "new / removed / risky" states | YES | Nothing new — but do NOT bless hard-coded hexes as the state mechanism | "State travels in `ok`/`bad` classes; hexes are decoration only" | TBD | TEACH classes, discourage hex-state |
| `near` + legend | YES (screenshot: legend box top-right) | Not taught | Colour/state legend next to the diagram | n/a (legend uncited) | Nothing | One example | TBD | TEACH |
| caps (12 shapes / 16 conns) | Today's pre-check fires (measured); raw renders far beyond it — see §Caps | Resource: 5,000 shapes → 451 MB; 1 MB input → 5.6 s (docs) | Real diagrams need ~8–15 shapes (richest samples here: 8) | n/a | Replace with sized ceiling (§Caps) + existing timeout/output caps | New numbers + "one idea per diagram" | TBD | LIFT to sized ceiling |

## Caps: measured, and the proposed ceiling

Chain diagrams `s0 -> s1 -> …` (2 cites each), pinned d2, same flags:

| shapes | conns | wall | raw SVG | post SVG | max RSS |
|---|---|---|---|---|---|
| 12 | 11 | 43 ms | 40 KB | 41 KB | 35 MB |
| 20 | 19 | 39 ms | 59 KB | 61 KB | — |
| 30 | 29 | 45 ms | 84 KB | 87 KB | 38 MB |
| 50 | 49 | 54 ms | 132 KB | 137 KB | — |
| 80 | 79 | 68 ms | 206 KB | 214 KB | 41 MB |

Linear (~2.6 KB/shape), RSS flat at ~40 MB, compile <0.1 s at 80 shapes.
The 512 KB output cap binds at ~190 shapes; the 15 s timeout never comes
close. Real explanatory diagrams need far less (richest sample here: 8
shapes). **Proposed ceiling: 40 shapes / 48 connections** — 3× the old
shape cap with 4× headroom to the byte cap, same timeout + output caps
unchanged. Deterministic, no new machinery.

## Boards / animation: viewer findings (no build, per brief)

- d2 emits boards only to a **directory** (one SVG per board, board-named,
  extensionless) or a **single animated SVG** via `--animate-interval N`
  to a **file** — never to stdout. Our pipeline renders `- -` (stdin→stdout),
  so boards need a pipeline branch: detect board words → compile to temp dir
  (per-board cache entries, viewer tabs) or with `--animate-interval` to a
  temp file (one animated entry).
- The animated SVG is CSS-only (`@keyframes d2Transition-<salt>-N`, nested
  `<svg>` per board, opacity cycling) — it **plays in our viewer unchanged**
  (inline SVG; service + web passes keep everything: keyframes, nesting,
  anchors). No SMIL.
- **Reduced motion: NOT respected** — d2 emits no `prefers-reduced-motion`
  query. Cost: one viewer CSS rule
  (`@media (prefers-reduced-motion: reduce) { .dg-svg *, .dg-ov-doc * { animation: none !important; } }`)
  plus freezing on first board (opacity animation off shows board 1 — verify
  in the live pass).
- Staying citeable: YES — all 3 cites present as `data-refs` in the animated
  SVG; per-board SVGs carry their own board's cites.
- Cost estimate: pipeline branch (flag + temp file/dir + per-board cache keys,
  ~1 day) + optional board-tab UI if per-board is chosen over animated
  (~2–3 days) + the reduced-motion rule (trivial). Recommend: animated SVG
  first (no UI), board tabs only if the owner wants scrubbing.

## Icons: allowlist findings (owner decision 2026-10-27)

- URL form that works: `https://icons.terrastruct.com/<set>%2F<name>.svg`
  (`%2F`-escaped; `/` form 403s). Catalogue verified from the site index:
  **1274 real paths** (`/tmp/icon-names.txt` method; sets: aws 572, azure 262,
  dev 123, gcp 109, essentials 100, social 37, tech 21, infra 17, emotions 33).
- Hit/miss: **12/12 verified-real names → 200** (0.6–8.3 KB, 0.03–0.15 s);
  **12/12 plausible invented names → S3 403** (model-guessed numbers,
  singular/plural, wrong case, `database-server`-style inventions all miss).
  Guidance fix: the convention must list **verbatim paths** (a curated ~10
  for code explanations); a name-normalising pre-pass cannot rescue invented
  names cheaply — but it doesn't need to, because…
- 404 fallback works: strip the `icon:` key, record the reason (for Debug),
  render without — diagram + cites intact (demoed).
- Who fetches: **d2 fetches at compile time**, and with `--bundle=false` it
  does NOT fetch at all — it emits remote `<image href>` (the view-time
  network hole the ban was defending). Local files ARE embedded as
  `data:` even with `--bundle=false`. So the pipeline **pre-fetches the
  allowlisted bytes itself** (exact host, https, no `?`/`#`, `.svg`, 5 s cap,
  100 KB cap), stages them, rewrites to `./file`, compiles sandboxed.
- Defence holds: disallowed host / query / fragment rejected pre-compile
  (demoed, 4 cases); fetched bytes 0.6–8.3 KB — no timeout/output-cap impact
  (one diagram with 5 icons ≈ +50 KB worst case).
- One gap to close: both sanitisers drop `<image>` entirely today, so the
  icon vanishes without a **keep-`<image>`-iff-`data:image/*`** rule (demoed
  working with all-real stages + the one-line variant; external hrefs: none).

## Proposed new `d2-convention.md`

```md
Diagrams are fenced `d2` blocks, optionally followed by a `Caption:` line.
Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from your
context, no [[ ]]) inline in braces on each shape or connection that maps
to code (at least 2), e.g. `a -> b: unfold {link: "diff:conn:91-110"}` or
`norm: "_normalize_header_values" {link: "diff:conn:80-88"}` (a `link:` on
its own indented line is silently dropped — always attach inline).
D2 rules: first line `direction:` to suit the flow (`right` for
left-to-right pipelines, `down` for top-down chains); `shape:
sequence_diagram` for sequences with participants; shapes as `id: "Short
label"` with every label short (a few words, at most two lines — long
single-line labels overflow their boxes); edges as `a -> b: label`; mark
a good/bad outcome with `myid.class: [ok]` / `[bad]` on its own line
(never inside `{ ... }`); state travels in `ok`/`bad` classes, never in
hard-coded colours.
Structure: group with containers (`parser: { msg: "HTTPMessage" ... }`);
before/after with `grid-rows: 1` + `grid-columns: 2`; phases in sequences
with a labeled container (`phase: { label: "unfold" ... }`).
Sequences: spans with `a -> a.span: label`; self-messages with
`a -> a: label`; notes ONLY as `participant.note: "text"` (a bare `note:`
line becomes a bogus participant); messages cite inline, spans cite inline.
Edges: optional flow as `a -> b: {style: {stroke-dash: 4}}` on its own
line after the labeled edge; emphasis as `{style: {stroke-width: 5}}`;
branching heads as `a -> b: {target-arrowhead: {shape: diamond}}`
(`target-arrowhead` sits beside the label, never inside `style:`);
flowing edges as a block map `a -> b: label { link: "…"; style: {
animated: true } }`. Tables: `shape: sql_table` for schemas, `shape: class`
for types — cites go on the TABLE, never on rows or fields (row links are
silently dropped). Shapes carry meaning: cylinder = datastore, diamond =
branch, queue = buffer/retry, person = owner, cloud = network, callout =
see-also, `text` = plain note; code lines as `|python … |` labels.
`vars:`, `classes:` stanzas, `tooltip:` (short, never a citation) and
`|md` / `|latex` labels are allowed; links inside md labels are stripped.
Icons: `icon: https://icons.terrastruct.com/<set>%2F<name>.svg` ONLY —
verbatim paths from this list (database: `aws%2FDatabase%2FAmazon-Aurora.svg`;
archive: `essentials%2F304-archive.svg`; …); any other host, and any `?`
or `#`, is rejected. A missing icon is dropped and the diagram renders
without it.
Boards (`layers`/`scenarios`/`steps`) draw before/after or lifecycles;
keep ≤4 boards (they play as one animation).
Never name a shape `steps`, `layers`, `scenarios` or `boards` (those words
switch on multi-board diagrams): call the box `flow` or `steps_box`.
Limits: at most 40 shapes and 48 connections; no imports (`...@`, `@file`,
`: @…`) ever. Example: [keep current example].
```

## Live pass: prepared only, NOT run (waiting on the owner's cap)

- Harness (to write under `spikes/d2-features/`, `test:live:*-style`):
  extend `scripts/live-diagram.mjs` — same built-service + demo-review setup —
  with the proposed convention above, one diagram task per feature group
  (~14 tasks: containers, edge styles, grid, sql/class, shapes, code label,
  seq spans/self/notes, animated edge, md+latex, icon-allowlisted, boards,
  caps-scale) × 2 providers (Claude + Codex) = ~28 generations, each
  rendered + validated (precheck, compile, cite-href check) with ≤1 repair.
- Real default model: Opus-class — static fallback `main:
  {provider: claude, model: claude-opus-5-5}` (`DEFAULT_SETTINGS`); live rule
  picks the newest offered Opus ≥5.5 (else Codex Sol). Second opinion rides
  the other provider; keep it OFF for this harness (diagram-only).
- Spend estimate (no tokens spent): per call ≈ convention+task prompt
  (~3–5k in) + diagram out (~0.5–1k) + ≤1 repair turn; at Opus pricing that
  is order **$0.05–0.15/call → ~$2–5 total for 28 calls**, Codex Sol similar
  or less. The owner sets the hard cap parameter before it runs.

## What's in this spike branch

- `spikes/d2-features/samples/` — 26 hand-written `.d2` (+ generated
  `gen-cap-*` chains)
- `spikes/d2-features/harness/` — `harness.ts` (real-pipeline render),
  `mechanism.ts` (lifted-ban probes), `icon-demo.ts` (allowlist end to end),
  `shots.mjs` (4-theme screenshots)
- `spikes/d2-features/out/` — `report.json`/`report.txt`, all post-processed
  SVGs, `shots/` (63 PNGs across Default/Studio × light/dark)
