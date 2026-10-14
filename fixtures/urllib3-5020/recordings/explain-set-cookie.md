`Set-Cookie` is the one header that can't be combined into a comma-separated list, because cookie attributes such as `Expires=Wed, 21 Oct 2026 …` contain commas themselves. urllib3's `HTTPHeaderDict` still keeps each `Set-Cookie` line separately (`getlist`), and the PR has to preserve that, along with the order of duplicate headers, when it rewrites the message. [[diff:tsock:124-127]]

::: simple
Each cookie has to stay as its own header line, because cookies contain commas. The fix keeps every cookie separate and in order.
:::

::: deep
Set-Cookie breaks the general rule that repeated fields are equivalent to one comma-joined field (RFC 9110 section 5.3 calls this out explicitly). Any header normalization therefore has to work on the list of (name, value) pairs, never on a joined map, which is why the helper takes `message.items()` and writes them back in order.
:::

::: example
```
r.headers["set-cookie"]         # 'foo=1, bar=1'   (joined: lossy)
r.headers.getlist("set-cookie") # ['foo=1', 'bar=1'] (kept apart)
```
:::

```json
{
  "title": "Why Set-Cookie lines stay separate",
  "anchor": {"quote": "Set-Cookie", "host": "card:problem#b1"}
}
```
