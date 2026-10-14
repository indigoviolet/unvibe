::: example
```
value = " " * 100_000 + "x"
re.sub(r"[ \t]*\r\n[ \t]+", " ", value)               # O(n^2): slow
re.sub(r"(?:(?<![ \t])[ \t]+)?\r\n[ \t]+", " ", value) # O(n)
```
:::

::: example
```
r.headers["set-cookie"]         # 'foo=1, bar=1'   (joined: lossy)
r.headers.getlist("set-cookie") # ['foo=1', 'bar=1'] (kept apart)
```
:::

```json
{
  "title": "The central change",
  "depth": {"level": "standard", "cardId": "central"}
}
```
