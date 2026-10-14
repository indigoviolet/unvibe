`_normalize_header_value` first checks `"\r\n" not in value` and returns the value untouched if there's no CRLF. Almost no real header is folded, so nearly every value skips the regex entirely. The message is only rewritten if at least one value actually changed. [[diff:conn:86-87]]

::: simple
Most headers have no line break, so the code checks for one first and skips the work when there isn't any.
:::

```json
{
  "title": "The fast path",
  "anchor": {"quote": "a fast path skips any value without CRLF", "host": "card:central#b4"}
}
```
