The lookbehind `(?<![ \t])` makes the optional leading whitespace match start only at the first space of a run [[diff:conn:80-82]]. That stops the engine from rescanning long runs of spaces from every position, so the time is linear in the value's length.

```json
{}
```
