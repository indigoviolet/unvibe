# Spike: finding the enclosing function or class of a hunk (issue #133)

Write-up: [`docs/diff-expand-evaluation.md`](../../docs/diff-expand-evaluation.md). Not part of the product; lives on `spike/diff-expand` only.

```
corpus/cases.txt    111 hunks with the expected enclosing units written by hand
harness/            candidates, scorer, timing, labelling aids
results/            raw output of the runs behind the write-up
```

## Run it

```sh
cd spikes/diff-expand
npm install --ignore-scripts          # candidates live only in this directory
node harness/fetch-corpus.mjs         # clones 10 repos + 3 files into /tmp/diffexpand-spike (SPIKE_WORK overrides)
node harness/score.mjs                # accuracy tables -> results/scores.json
LOOSE_DOC=1 node harness/score.mjs    # same, accepting one blank line after a /** */ block
node harness/heldout.mjs 60           # agreement on unseen hunks -> results/heldout.txt
node harness/bench.mjs                # timings -> results/bench.txt
node harness/parse-errors.mjs ../..   # TypeScript files of this repo the grammar cannot fully parse
(cd harness/bundle-check && sh run.sh)  # web-tree-sitter inside an esbuild bundle
```

`fetch-corpus.mjs` fetches each commit by hash, so the corpus is reproducible. `heldout.mjs`
samples from whatever history the clones have, so its numbers move with clone depth
(the write-up used `--depth 250` clones).

| File | What it is |
|---|---|
| `harness/units.mjs` | what counts as a unit per language, and the walk from "node covering the change" to the chain of units |
| `harness/cand-wts.mjs` | web-tree-sitter + `.wasm` grammars (recommended) |
| `harness/cand-astgrep-napi.mjs`, `cand-astgrep-cli.mjs`, `cand-astgrep-outline.mjs` | ast-grep three ways |
| `harness/cand-lezer.mjs` | Lezer, pure JavaScript parsers |
| `harness/cand-git.mjs` | `git diff -W`, with and without the built-in language patterns |
| `harness/heuristic.mjs` | indentation + keyword heuristic (the fallback) |
| `harness/view2.mjs`, `list-hunks.mjs`, `find-hard.mjs` | how the corpus was picked and labelled |
