`_OBSOLETE_FOLD_RE = (?:(?<![ \t])[ \t]+)?\r\n[ \t]+` [[diff:conn:82]]

- `(?:…)?`: optional whitespace before the line break, the `OWS` in `OWS CRLF RWS`.
- `(?<![ \t])`: that optional whitespace may only start where the previous character isn't a space or tab, i.e. at the start of a run. [[diff:conn:80-81]]
- `\r\n`: the line break itself.
- `[ \t]+`: at least one space or tab starting the continuation line, the `RWS`.

Without the lookbehind, a long run of spaces that isn't followed by CRLF makes the engine try every start position and rescan the run each time, which is quadratic. With it, positions inside a run fail at once, so the scan is linear. [[diff:conn:80-81]]

### Follow-ups

- Why isn't this tested? | ask: test

```json
{
  "title": "The pattern: why the lookbehind matters",
  "cardId": "g-regex"
}
```
