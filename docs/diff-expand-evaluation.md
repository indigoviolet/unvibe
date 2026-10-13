# Expanding a hunk to its enclosing function or class: how to find the unit (issue #133)

Spike branch `spike/diff-expand`. Harness, corpus and raw results: `spikes/diff-expand/`. Nothing here is in the product.

## 1. Recommendation

**Use tree-sitter compiled to WebAssembly, in the service, with the indentation heuristic as the fallback.** That means the `web-tree-sitter` runtime plus one prebuilt `.wasm` grammar per language, copied into the release at build time. The service parses the file at the commit, on demand, and caches the result by file content.

Two facts decide it:

1. **Accuracy.** On 110 hand-labelled real hunks it found the exact innermost unit in 104, and the whole chain (method, then class, then module) in 50 of the 51 hunks that have more than one level. ast-grep's library scores the same, because it uses the same grammars. `git diff -W` got 27 right, the heuristic alone 72, and `ast-grep outline` (the owner's suggestion) 49.
2. **Install.** It is plain files: 156 KB of JavaScript inside the service bundle and 7.8 MB of `.wasm` (about 0.8 MB gzipped). There is no native code, no install script, no per-platform package and no new runtime dependency, so `npm install -g` behaves the same on every platform. ast-grep needs a native addon per platform plus five grammar packages that each run a postinstall script, about 61 MB in total.

The fallback covers languages without a grammar and files the parser cannot read. It is right about two times in three and should be shown as approximate. `git diff -W` should not be used for this: it finds where a function starts but not where it ends.

**Expand by lines needs no parser** and can ship first (section 4).

## 2. Comparison

### What was tested

- **Corpus:** 111 hunks, 110 scored. 106 are real hunks from commits in 11 repositories (flask, httpx, cobra, gin, ripgrep, axum, gson, sinatra, rack, express, and this repo for TypeScript and TSX). 5 are chosen ranges in single files: a 52.7k-line TypeScript file, a 12.7k-line Python file, two files with a syntax error, and a minified file (timed, not scored).
- **Labels:** the expected chain of units for each hunk is in `spikes/diff-expand/corpus/cases.txt`. 16 hunks expect "none" (top-level code, or a change that crosses two definitions).
- **Hard cases included on purpose:** nested functions and closures, methods four levels deep (Ruby), decorators, attributes and doc comments, a change only in a doc comment, a whole new function, arrow functions bound to constants, functions as object properties, JSX, `describe`/`it` blocks, Go receivers, Rust `impl` and `mod tests`, Java anonymous classes, example code inside a Python docstring, heredocs, and syntax errors.
- **Scoring:** *exact* means the start (including decorators and the doc comment) and the end both match. *Lead* means only the leading comment or decorator lines differ. *Wrong* is any other range. *Nothing* means no unit was returned.

### Accuracy: innermost unit, exact / lead / wrong / nothing

| Candidate | Python (17) | Go (15) | Rust (14) | Java (14) | Ruby (15) | JS (10) | TS (14) | TSX (11) | All (110) | Whole chain right (51 with 2+ levels) |
|---|---|---|---|---|---|---|---|---|---|---|
| **tree-sitter wasm** | 17/0/0/0 | 15/0/0/0 | 14/0/0/0 | 14/0/0/0 | 15/0/0/0 | 4/3/1/2 | 14/0/0/0 | 11/0/0/0 | **104**/3/1/2 | **50** |
| ast-grep napi | 17/0/0/0 | 15/0/0/0 | 14/0/0/0 | 14/0/0/0 | 15/0/0/0 | 4/3/1/2 | 14/0/0/0 | 11/0/0/0 | **104**/3/1/2 | **50** |
| ast-grep CLI, `scan` rule (simplified) | 17/0/0/0 | 12/0/0/3 | 13/0/1/0 | 11/0/2/1 | 14/0/0/1 | 1/0/0/9 | 9/0/2/3 | 9/0/1/1 | 86/0/6/18 | 39 |
| ast-grep CLI, `outline` | 11/4/2/0 | 5/7/0/3 | 8/5/1/0 | 6/3/4/1 | 4/1/9/1 | 1/0/0/9 | 7/1/1/5 | 7/2/1/1 | 49/23/18/20 | 23 |
| Lezer (pure JS) | 17/0/0/0 | 15/0/0/0 | 9/4/1/0 | 14/0/0/0 | no grammar | 4/3/1/2 | 13/0/1/0 | 11/0/0/0 | 83/7/3/2, 15 unsupported | 33 |
| `git diff -W` + built-in language patterns | 8/0/8/1 | 4/0/11/0 | 2/0/12/0 | 1/0/12/1 | 2/0/12/1 | 1/0/9/0 | 4/0/9/1 | 5/0/5/1 | 27/0/78/5 | 0 |
| `git diff -W`, no configuration | 8/0/9/0 | 2/0/13/0 | 3/0/11/0 | 2/0/12/0 | 1/0/14/0 | 1/0/9/0 | 4/0/9/1 | 5/0/5/1 | 26/0/82/2 | 0 |
| Indentation heuristic | 15/0/2/0 | 9/0/1/5 | 10/0/2/2 | 4/0/9/1 | 14/0/0/1 | 4/0/1/5 | 6/0/3/5 | 10/0/0/1 | 72/0/18/20 | 25 |

Every failure of every candidate is listed in `spikes/diff-expand/results/scores.txt`.

Notes on the rows:

- **tree-sitter wasm and ast-grep napi are the same rules on the same grammars** (`harness/units.mjs`); only the engine differs.
- **`git diff -W`** finds a start line by regular expression and ends the unit just before the next line that matches. On the 94 hunks that have a unit, the start was right in 53 and the end in 25 (with the language patterns). It also reads example code in a Python docstring as a real `def` (py01, py13). The language patterns can be switched on from outside the reviewed repository with `git -c core.attributesFile=<file>`. Git 2.43 has no patterns for JavaScript or TypeScript.
- **`ast-grep outline`** lists a file's top-level items and their direct members, so it gives two levels at most. It does not see nested functions, callbacks, or Ruby methods nested three deep, and it leaves out doc comments and decorators (the 23 "lead").
- **Lezer** got the same rules with only the node names translated and no tuning. Its Rust rows lose attribute lines, and it mis-read the TypeScript file with a missing brace (ts14).
- **The heuristic** is the code in `harness/heuristic.mjs`. It is strong where indentation carries structure (Python 15/17, Ruby 14/15) and weak where a keyword list cannot recognise a method (Java 4/14).

### Install, platforms, licence

| | tree-sitter wasm | ast-grep napi | ast-grep CLI | Lezer | git | heuristic |
|---|---|---|---|---|---|---|
| Packages | `web-tree-sitter` 0.27.1, grammars from `@vscode/tree-sitter-wasm` 0.3.1 | `@ast-grep/napi` 0.50.0 + 5 × `@ast-grep/lang-*` | `@ast-grep/cli` 0.50.0 | `@lezer/*` (7 packages) | already required | none |
| Native code | none | yes (addon + `parser.so` per language) | yes (binary) | none | n/a | none |
| Size needed for the 8 languages | 156 KB JS + 210 KB runtime wasm + 7.6 MB grammars (0.75 MB gzipped) | about 8 MB addon + about 52 MB grammar packages (each ships every platform's build and its C source) | 52 MB | 2.2 MB | 0 | 0 |
| Install scripts | none | `postinstall` in each `@ast-grep/lang-*` | `postinstall` | none | n/a | none |
| Compiles when a prebuilt is missing | nothing to compile | addon: no, it throws at load. Grammars: yes, the postinstall runs `tree-sitter build` (needs `tree-sitter-cli` and a C compiler); a failed build is only logged | no; the postinstall exits 1 | no | n/a | no |
| darwin-arm64 | same files | prebuilt (metadata, resolved here) | prebuilt (metadata, resolved here) | same files | | |
| darwin-x64 | same files | prebuilt (metadata, resolved here) | prebuilt (metadata, resolved here) | same files | | |
| linux-x64 glibc | **run here** | **run here** | **run here** | **run here** | **run here** | **run here** |
| linux-arm64 glibc | same files | prebuilt (metadata, resolved here) | prebuilt (metadata, resolved here) | same files | | |
| linux musl (x64, arm64) | same files | addon prebuilt; grammars have **no musl build** (the glibc `parser.so` is picked) | **no package**; install would fail | same files | | |
| With `--ignore-scripts` | unaffected | works where a prebuilt grammar exists (run here) | works through a JS shim that spawns the binary and prints a warning on every call (run here) | unaffected | | |
| Languages | 8 needed; 16 in the vscode package, 36 in `tree-sitter-wasms` | JS, TS, TSX, HTML, CSS built in; the rest through `lang-*` packages | all 8 built in | no Ruby | patterns for Python, Go, Rust, Java, Ruby; none for JS/TS | any |
| Chain of units | yes | yes | yes, by filtering matches | yes | no, one level | yes, weaker |
| Licence | MIT (runtime and grammars) | MIT; `lang-*` ISC | MIT | MIT | GPL-2.0, external tool | ours |

"Resolved here" means: on this Linux x64 machine I ran `npm install --ignore-scripts --os=<os> --cpu=<cpu> [--libc=<libc>]` for each of the six targets and checked which platform packages npm selected and what kind of binary each contains (`file`: Mach-O arm64, Mach-O x86_64, ELF aarch64, ELF x86-64). None of those binaries was executed.

Three more facts about packages:

- `@vscode/tree-sitter-wasm` has a script named `install-emsdk` that calls `sudo`. It is a development script, not an npm lifecycle hook, so it does not run on install. It would be a build-time dependency only.
- The official `tree-sitter-<lang>` packages also contain the `.wasm` file, but they run `node-gyp-build` on install (prebuilt for macOS and Linux, x64 and arm64, otherwise it compiles). They must not become runtime dependencies.
- `ast-grep outline` exists only in the CLI. The napi package has no outline call.

### Speed and memory (Node 24, this machine, each number from a fresh process)

"Cold" is from process start to the first answer, including loading the grammar. "Warm" is parse plus lookup for the same file again. Bare `node` start is 29 ms.

| File | tree-sitter wasm | ast-grep napi | Lezer | ast-grep CLI (per call) | `outline` (per call) | git (per call) | heuristic |
|---|---|---|---|---|---|---|---|
| typical .tsx, 667 lines | cold 82 ms, warm 5.9 ms | 40 / 4.1 | 90 / 10.2 | 15 ms | 47 ms | 3.9 ms | 0.3 ms |
| typical .py, 541 lines | 66 / 5.2 | 41 / 1.9 | 90 / 5.1 | 12 ms | 46 ms | 4.2 ms | 0.2 ms |
| frame.py, 12.7k lines, 447 KB | 131 / 58 | 80 / 39 | 154 / 67 | 117 ms | 119 ms | 13 ms | 3.1 ms |
| checker.ts, 52.7k lines, 3.1 MB | 699 / 529 | 399 / 331 | 941 / 855 | 728 ms | 416 ms | 56 ms | 12.5 ms |
| react.min.js, 11 KB | 65 / 5.6 | 41 / 3.5 | 78 / 8.7 | 16 ms | 44 ms | 4.0 ms | 0.01 ms |

Process memory after parsing checker.ts eight times: tree-sitter wasm 152 MB, Lezer 343 MB, ast-grep napi 565 MB. For ordinary files all are between 50 and 90 MB, of which about 47 MB is Node itself.

### Where it should run

**In the service.**

- The service already reads a file at a commit with `git show <rev>:<path>` (`readCodeSlice` in `packages/service/src/mcp/read.ts`). The parser needs exactly that text.
- WebAssembly in Node does not touch the web app's content security policy.
- I bundled a small program with the service's esbuild settings: `web-tree-sitter` bundles into the output (156 KB) and loads its runtime and grammar `.wasm` files from a folder beside the bundle, with no `node_modules` present (`harness/bundle-check/run.sh`).

Running it in the browser instead would cost three things: `script-src` would need `'wasm-unsafe-eval'` (browsers require it to compile WebAssembly; I did not test this), the browser would download up to 7.8 MB of runtime and grammars, and the whole file on both sides would have to be sent to the browser first. Lezer is the candidate that would run in the browser under today's policy, but it has no Ruby grammar and was less accurate.

### How each candidate handles the awkward situations

| | tree-sitter wasm / ast-grep napi | git -W | heuristic |
|---|---|---|---|
| Old side and new side | Parse each side's file separately and ask with that side's line range. Each side gets its own chain, so a unit that moved, grew or was renamed is found on both sides independently. | Reports one range per side of its own hunk | Same as tree-sitter: once per side |
| File exists at one revision only | Only that side is parsed | Works | Works |
| Language it does not know | Returns "unsupported" at once (no grammar file), so the fallback runs. ast-grep napi throws for an unregistered language. | Uses a generic pattern silently and answers anyway, usually wrongly | Always tries |
| Syntax error | Both syntax-error cases were exact. Units inside an error region are dropped (see limits). | Unaffected | Wrong on the missing-brace case |
| Minified file | Answers "lines 1 to 31", which is useless | Same | Nothing |
| Where the content comes from | `git show <sha>:<path>` for base and head | Needs both revisions in a repository or two files | Same as tree-sitter |

Only the new side was scored. The old side uses the same code on the base file but has no labels in this corpus.

## 3. Failures and limits of the recommended approach

**In the corpus (6 of 110):**

- **JSDoc separated from the function by a blank line** (express style): 5 cases. In 3 the unit is right but the comment above it is left out (js06, js09, js10). In 2 the change is only in that comment and nothing is returned (js01, js02). Accepting one blank line after a `/** */` block fixes the first 3, giving 107 exact (`LOOSE_DOC=1`). The other 2 need the same loosening in one more place; I did not build that.
- **A callback inside `it()` counted as a level** (js04). `describe` and `it` blocks are treated as units because readers think of them that way, but syntax cannot tell them from an ordinary callback such as `router.param('user', function …)` inside a test. The result is one extra, smaller step before the `it` block.

**Found outside the corpus:**

- **The TypeScript grammar does not parse `import("x").Type[]`.** 8 of this repo's 407 TypeScript source files contain it and get an error node (`harness/parse-errors.mjs`). In one unseen hunk this made the parser report a JSX block as a "method". The rules now drop any unit inside an error region; for that hunk the answer became "nothing", and the heuristic also returned nothing. ast-grep has the same grammar and the same error nodes.
- **The grammars are not the newest.** The TypeScript grammar in `@vscode/tree-sitter-wasm` 0.3.1 is version 0.23.2 from November 2024; the package was last published in April 2026.

**About the numbers themselves:**

- **The 104 is optimistic.** I wrote the rules while labelling this corpus, and the labels started as the parser's proposal that I then checked by reading the lines around each boundary. As a counterweight I ran 480 hunks I had not looked at (60 per language): tree-sitter and Lezer, which are independent parsers, returned the same innermost unit in 343 of the 360 hunks where Lezer has a grammar. Of the 17 disagreements, 15 are Rust. I read 4 of those and tree-sitter was right in all 4 (Lezer dropped an attribute line). The one TSX disagreement is the error-node case above. I did not read the rest (`results/heldout.txt`).
- **"Unit" is a choice.** Named functions and methods, closures bound to a name, classes and other type definitions, and blocks passed to a call at module level count. A callback inside a function does not, and neither does a one-line declaration. The owner may want different rules; they are the tables at the top of `harness/units.mjs`.
- **Not in the corpus:** hunks that only delete lines, TypeScript `namespace` blocks, languages other than the eight. Nested modules and classes are covered through Ruby, Rust and Java.

**Operational limits to design for:**

- **Large files:** half a second and about 150 MB for a 3 MB file. Parse on demand, one at a time, cache by content, and skip files over a size limit.
- **Minified or single-line files:** skip them (very long lines), since a line-based unit means nothing there.
- **Memory:** `web-tree-sitter` trees must be freed by hand (`tree.delete()`), or the wasm memory grows.
- **More languages:** each needs a `.wasm` grammar (Kotlin, Swift, C and others are in `tree-sitter-wasms`, which I did not test with this runtime) and about ten lines of rules.

## 4. What the build would involve

**Expand by lines (no parser, can ship first)**

- `packages/shared`: a request and response type for "lines `start` to `end` of `path` on side `old|new` of this review", returning the lines, the file's total line count and the commit. #81 needs the same route.
- Service: one route over `readCodeSlice`, taking the base or head commit from the review, with a cap on lines per request.
- Web: controls above and below each hunk and in the gap between two hunks; revealed rows drawn as context and visibly different; collapse; Shiki colours; both sides kept aligned in split view. Anchors for revealed lines use the existing `code:<path>:<lines>@<sha>` form.

**Expand by unit**

- `packages/shared`: `EnclosingUnit { kind, name, start, end }` and a response with the units of one file side plus how they were found (`"parser" | "heuristic" | "none"`). I suggest one outline per file side rather than one call per hunk: the web can then pick the chain for any hunk by range, name the unit in every hunk header, and step outward without another request. The harness answers per range; the outline form is the same rules run over the whole tree, which I did not build.
- Service: a new module (for example `src/outline/`) holding the grammar loader, the unit tables and walk from `units.mjs`, and the heuristic. It reads the file with `git show`, caches by blob id and language with a bounded cache, enforces the size limits, and falls back to the heuristic when there is no grammar or the parser returns nothing in a file with errors.
- Build and release: `web-tree-sitter` and the grammar package become devDependencies. The build copies `web-tree-sitter.wasm` and the eight grammar files into the service's `dist/`, the release script ships them, the global-install check asserts they are present, and `THIRD-PARTY-NOTICES.md` gains the MIT notices. The generated release `package.json` gets no new dependency.
- Web: an "expand to function / class / file" control that steps one level out per click, the unit name in the hunk header, and a marker when the range came from the heuristic.
- Tests: the unit rules against small fixture files with the real grammars (no network, no agents), and the routes with stubbed `git`.

**Feeding agents a hunk with its enclosing function** would reuse the same outline. It is outside this issue.

## 5. What I could not verify

- **Running on macOS (arm64, x64), Linux arm64 or musl.** Only Linux x64 glibc was run. For the wasm route there is nothing platform-specific to install, but I did not execute it elsewhere.
- **The ast-grep CLI failing to install on musl:** read from its `postinstall.js` and from npm selecting no binary package; not run.
- **Whether the glibc-built `@ast-grep/lang-*` grammar loads on musl.** It links `libc.so.6`.
- **The browser needing `'wasm-unsafe-eval'`:** not tested here.
- **Accuracy on the old side of a diff and on delete-only hunks:** not labelled.
- **Long-running memory in the service:** only short processes were measured.
- **Grammars from `tree-sitter-wasms` with `web-tree-sitter` 0.27.**
- **13 of the 17 held-out disagreements** were not read.
- **Timings on a slower or busier machine.** This one had 16 cores and a load of about 1 during the run.
