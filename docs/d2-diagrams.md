# D2 diagrams: decision and design

Diagrams in the guide are written by agents in [D2](https://d2lang.com) and rendered on the service by the `d2` program installed on the user's machine. This file records the decision and the rules the code implements. The evaluation that led here (Mermaid, a JSON spec, D2, Excalidraw, Graphviz, reladraw; screenshots, measurements, the reliability run) is on the branch [`spike/diagram-options`](https://github.com/indigoviolet/unvibe/tree/spike/diagram-options), in `docs/diagram-options.md`.

## Decision (2026-10-11)

- D2, with the `d2` binary required on the user's machine and all rendering done service-side. No diagram code ships to the browser and no WebAssembly runs there.
- We run a user-installed program and never bundle D2 (it is MPL-2.0).
- D2's SVGs carry `<style>` blocks and inline `style=` attributes, so the security policy keeps `style-src 'unsafe-inline'`.
- Mermaid was removed entirely. A `mermaid` fence in a reply is an ordinary code block.
- Without `d2` (or below the minimum version) everything else works and diagrams show as their source text.

## What agents write

A fenced `d2` block, optionally followed by a `Caption:` line. A citation goes directly on a shape or connection as a quoted bare token, inline in braces:

```d2
normalize: _normalize_header_values { link: "diff:conn:91-110" }
```

No `[[ ]]` wrapper and no `tooltip:`. The single source of the wording given to models is `prompts/includes/d2-convention.md`. In a 16-generation live run across both providers, every output compiled first try and citations reached the SVG intact in 15 of 16 first try, 16 of 16 after one repair.

## Look (issue #16)

The two renders keep D2's built-in themes (0 light / 200 dark); the web
 app remaps D2's uniform blue to the guide palette with stylesheet rules
 over the classes D2 emits (`prototype.css`, `.dg-d2 …`), so served bytes
 — and the fixture seeds — never change. Agents mark a good/bad outcome
 with `myid.class: [ok]` / `[bad]` on its own line: D2 passes unknown
 classes through and the stylesheet paints them with the guide's ok/warn
 colours. `classes:` stanzas stay rejected by the pre-check (they can
 smuggle fonts), as does `.class:` inside `{ … }` (invalid D2 — the
 pre-check names the legal line form so the repair turn can act).

## Pipeline (`packages/service/src/diagrams/`)

1. Rename unambiguous reserved-word shapes: a top-level `steps: "label"`
   with a same-line scalar value (and its connection/dotted references)
   becomes `steps_box` instead of failing.
2. Extract every `link:` value from the source.
3. Validate each as a citation with the standard validator (ranges, automatic repair, unverified marking).
4. Pre-check the source against the deny list below, then compile with the binary.
5. Check that every validated citation has a matching `href` in the SVG. D2 silently drops a `link:` written on a dedented line under a sequence message, so a clean exit code is not enough.
6. Any failure in 3 to 5 triggers exactly one repair turn carrying the validator or compiler message.
7. Render light and dark, rewrite citation anchors to `<a href="#" data-refs data-src>`, strip `<title>` tooltips that contain tokens, sanitise, and cache by content hash. The web app fetches `GET /api/reviews/:id/diagrams/:hash?theme=`.

The sanitiser keeps everything D2 needs for layout: tspan `x`/`dy`
(multi-line labels) and `dx`, `mask` + `maskUnits` (the gap edges leave
behind their labels), plus the `url()` references to them through both
the service and the per-instance web adopt passes. The data-dir cache filenames carry
`DIAGRAM_POSTPROCESS_VERSION` (`<hash>.v<version>.<theme>.svg`), so
renders cached by an older sanitiser are never served stale — legacy
unversioned files are swept on start. Fixture seeds keep the unversioned
layout; they ship with the code, so re-record them (`mise run
fixture-snapshot`) whenever the sanitiser keeps more or less.

## Inline diagrams (issues #71, #130)

Only the Add diagram action used to run the pipeline above. Since #130,
diagrams written inline in Explain expansions go through the same
finalize (rename, cite validation, compile-check, render, cache) and get
exactly one repair turn on failure, so stored blocks carry a real status
(`pipeline/actions/diagram-finalize.ts`, shared with the Add diagram
action). The same finalize covers go-deeper results and concept pages
(one repair turn on the fill's own session — enqueueing a nested repair
job could deadlock against the per-provider cap) and diagrams nested in
asides at any depth (repaired diagrams splice into the failed slots in
depth-first order, keeping the stored ids). Since #145 it also covers
diagrams the reader writes inline in guide cards (flattened across the
reply's cards for one shared repair turn on the reader session, then
split back across the cards — `splitFinalizedBlocks` in
`pipeline/apply.ts`) and diagrams in second-opinion reasoning (the
repair turn runs on the second-opinion session/model, not the main one,
and finalize never touches the shared log, so the isolation in
`secondopinion/base.ts` holds). Ask thread replies are excluded (raw `<pre class="d2">`
source in message HTML, not blocks — shown as static source text; with
#136). Hash
lookup covers every live `Block[]` list through one shared walker
(`packages/shared/src/content/blocks.ts`), so a new container is added
there, not in the route. Undo-stack revisions are excluded (stale, never
rendered).

A fenced `d2` block anywhere else is stored with `render.status:
"unavailable"` and rendered on demand when the web fetches it: from the
fixture-seed cache, or by compiling then (the binary may have appeared
since).

## Endpoint statuses (issue #130)

`GET /api/reviews/:id/diagrams/:hash` answers `409` with a
`DiagramStatusBody` (contract in `packages/shared/src/api.ts`) when the
hash is known but has no SVG. The two statuses are never inferred from
each other:

- `unavailable`: the `d2` binary is missing or too old, so nothing was
  attempted. Only this status renders the install hint (Settings →
  Environment).
- `error`: `d2` ran and the source failed (pre-check rejection or
  compiler/render failure). The body carries the raw message for the
  Debug page; the reader sees a plain "Couldn't draw this diagram."
  with a retry, and no zoom, Reset or Expand controls.

A block with no render result yet (nothing to fetch by) shows a neutral
"Drawing diagram…" state, never a claim about `d2`.

## Defences

The source is agent-written, and the binary will act on it. Observed with d2 0.9.0:

| Input | What the binary does | What we do |
|---|---|---|
| `icon:` with a URL, `shape: image` | Fetches the URL at compile time; an unreachable URL fails the whole render | Rejected before compiling |
| Imports (`...@file`, `x: @file`) | Reads arbitrary local files into the SVG; there is no flag to disable imports | Rejected before compiling; the process runs in an empty temporary directory |
| Markdown, LaTeX and block-string labels | Markdown links become real external links | Rejected before compiling |
| `link: "javascript:…"` or `data:` | Passed through unchanged into `href` and `xlink:href` | Every `link:` must match the citation grammar; after rendering only recognised citations are rewritten and every other link is removed |
| Very large input | 5,000 shapes reached 451 MB of memory; 1 MB of input took 5.6 s | 64 KB input cap, 512 KB output cap, 12 shapes and 16 connections, 15 s timeout, 2 renders at a time |

Also rejected: `vars`, `d2-config`, classes that set fonts, `.class:` /
`class:` anywhere but a dotted `shape.class:` line (the only class syntax
D2 accepts; the prompt shows it — an inline `{.class: [bad]}` fails to
compile). Source goes in on stdin only, with a scrubbed environment.

Reserved board words (`layers`, `scenarios`, `steps`, `boards`) are
renamed, not rejected, where unambiguous: a top-level `steps: "label"`
with a same-line scalar value becomes `steps_box` (connection endpoints
and dotted keys follow). Block forms (`steps: { … }`) stay rejected with
a rename hint the repair turn can act on. The prompts list these words
as names a shape must never have, so the rename is a backstop, not the
plan.

## Version

Tested on d2 0.9.0 only; that is the minimum, checked by readiness and `unvibe doctor`, and the version pinned in `mise.toml` for development. D2 is pre-1.0: rerun the reliability harness on the spike branch before raising it. Output for the three demo diagrams is byte-identical on Linux and macOS (enforced in CI), which is what lets the demo ship pre-rendered SVGs addressed by content hash.
