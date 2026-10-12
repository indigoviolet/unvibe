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
— and the fixture seeds — never change. Agents may mark shapes
`*.class: [ok]` / `[bad]`: D2 passes unknown classes through and the
stylesheet paints them with the guide's ok/warn colours. `classes:`
stanzas stay rejected by the pre-check (they can smuggle fonts).

## Pipeline (`packages/service/src/diagrams/`)

1. Extract every `link:` value from the source.
2. Validate each as a citation with the standard validator (ranges, automatic repair, unverified marking).
3. Pre-check the source against the deny list below, then compile with the binary.
4. Check that every validated citation has a matching `href` in the SVG. D2 silently drops a `link:` written on a dedented line under a sequence message, so a clean exit code is not enough.
5. Any failure in 2 to 4 triggers exactly one repair turn carrying the validator or compiler message.
6. Render light and dark, rewrite citation anchors to `<a href="#" data-refs data-src>`, strip `<title>` tooltips that contain tokens, sanitise, and cache by content hash. The web app fetches `GET /api/reviews/:id/diagrams/:hash?theme=`.

## Defences

The source is agent-written, and the binary will act on it. Observed with d2 0.9.0:

| Input | What the binary does | What we do |
|---|---|---|
| `icon:` with a URL, `shape: image` | Fetches the URL at compile time; an unreachable URL fails the whole render | Rejected before compiling |
| Imports (`...@file`, `x: @file`) | Reads arbitrary local files into the SVG; there is no flag to disable imports | Rejected before compiling; the process runs in an empty temporary directory |
| Markdown, LaTeX and block-string labels | Markdown links become real external links | Rejected before compiling |
| `link: "javascript:…"` or `data:` | Passed through unchanged into `href` and `xlink:href` | Every `link:` must match the citation grammar; after rendering only recognised citations are rewritten and every other link is removed |
| Very large input | 5,000 shapes reached 451 MB of memory; 1 MB of input took 5.6 s | 64 KB input cap, 512 KB output cap, 12 shapes and 16 connections, 15 s timeout, 2 renders at a time |

Also rejected: layers, scenarios, steps, boards, `vars`, `d2-config`, classes that set fonts. Source goes in on stdin only, with a scrubbed environment.

## Version

Tested on d2 0.9.0 only; that is the minimum, checked by readiness and `unvibe doctor`, and the version pinned in `mise.toml` for development. D2 is pre-1.0: rerun the reliability harness on the spike branch before raising it. Output for the three demo diagrams is byte-identical on Linux and macOS (enforced in CI), which is what lets the demo ship pre-rendered SVGs addressed by content hash.
