The pattern is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`: optional spaces or tabs, then CRLF, then at least one space or tab. The `(?<![ \t])` lookbehind lets the optional whitespace match start only at the beginning of a run of spaces. Without it, a long run of spaces that isn't followed by CRLF makes the engine try every starting position and rescan the whole run from each one, which takes quadratic time. [[diff:conn:80-82]]

::: simple
The pattern finds "spaces, line break, spaces". A small extra check stops it re-reading the same spaces over and over, so very long header values can't make it slow.
:::

::: deep
Regex engines that backtrack retry at each start position. With `[ \t]*\r\n`, a run of n spaces costs n - i steps from position i, which is O(n^2) in total. The lookbehind fails in O(1) everywhere inside a run, so only the run's first character starts the expensive scan, which brings the total to O(n). It's the same idea as anchoring a token to its leftmost position.
:::

::: example
```
value = " " * 100_000 + "x"
re.sub(r"[ \t]*\r\n[ \t]+", " ", value)               # O(n^2): slow
re.sub(r"(?:(?<![ \t])[ \t]+)?\r\n[ \t]+", " ", value) # O(n)
```
:::

```json
{
  "title": "The fold pattern",
  "anchor": {"quote": "keeps it linear-time on long values", "host": "card:central#b4"}
}
```
