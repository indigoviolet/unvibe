RFC 9112 (HTTP/1.1 message syntax) deprecates line folding. A sender must not generate it. A recipient must either reject the message or replace each fold with one or more spaces before interpreting or forwarding it. urllib3 takes the replace option, with exactly one space per fold. [[desc:d-intro]]

::: simple
The HTTP standard says: don't send folded headers, and if you receive one, turn each fold into a space. That's what this PR does.
:::

```json
{
  "title": "What RFC 9112 requires",
  "anchor": {"quote": "Issue #1362 tracked the original report", "host": "card:problem#b2"}
}
```
