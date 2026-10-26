::: example
```
Set-Cookie: a=1; path=/ <CR><LF>
    Max-Age=900<CR><LF>

# http.client keeps:   'a=1; path=/ \r\n    Max-Age=900'
# urllib3 now returns: 'a=1; path=/ Max-Age=900'
```
:::

```json
{
  "title": "The problem",
  "depth": {"level": "standard", "cardId": "problem"}
}
```
