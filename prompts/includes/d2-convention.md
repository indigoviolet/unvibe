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
Edges: optional flow as a redeclared `a -> b: {style: {stroke-dash: 4}}`
line after the labeled edge; emphasis as `{style: {stroke-width: 5}}`;
branching heads as `a -> b: {target-arrowhead: {shape: diamond}}`
(`target-arrowhead` sits beside the label, never inside `style:`).
Tables: `shape: sql_table` for schemas, `shape: class` for types — cites go
on the TABLE, never on rows or fields (row links are silently dropped).
Shapes carry meaning: cylinder = datastore, diamond = branch, queue =
buffer/retry, person = owner, cloud = network, callout = see-also, `text` =
plain note; code lines as `|python … |` labels. `vars:`, `classes:` stanzas,
`tooltip:` (short, never a citation) and `|md` / `|latex` labels are
allowed; links inside md labels are stripped.
Icons: `icon: https://icons.terrastruct.com/<set>%2F<name>.svg` ONLY —
verbatim paths from this list, `%2F`-escaped, with no `?` or `#`. Any
other host is rejected; a missing icon is dropped and the diagram renders
without it. Copy paths exactly (invented names fail):
database `essentials%2F117-database.svg`, managed database
`aws%2FDatabase%2FAmazon-Aurora.svg`, cache
`aws%2FDatabase%2FAmazon-ElastiCache.svg`, stream/queue
`aws%2FAnalytics%2FAmazon-Kinesis.svg`, server
`essentials%2F112-server.svg`, compute host
`aws%2FCompute%2FAmazon-EC2.svg`, function
`aws%2FCompute%2FAWS-Lambda.svg`, network
`essentials%2F092-network.svg`, user `essentials%2F365-user.svg`, secret
`essentials%2F216-key.svg`, warning `essentials%2F060-warning.svg`, archive
`essentials%2F304-archive.svg`, file `essentials%2F257-file.svg`, search
`essentials%2F313-search.svg`, settings `essentials%2F204-settings.svg`,
flag `essentials%2F170-flag.svg`.
Never name a shape `steps`, `layers`, `scenarios` or `boards` (those words
switch on multi-board diagrams, which are not supported): call the box
`flow` or `steps_box`.
Limits: at most 40 shapes and 48 connections; no imports (`...@`, `@file`,
`: @…`), no `style.animated`, no `animate-interval` ever. Example:
