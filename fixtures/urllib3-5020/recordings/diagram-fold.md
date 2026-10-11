```diagram
{
  "version": 1,
  "kind": "panels",
  "title": "Folded and unfolded header values",
  "panels": [
    {
      "title": "On the wire",
      "lines": ["Set-Cookie: a=1; path=/ CRLF", "    Max-Age=900 CRLF"],
      "state": "bad",
      "cite": "diff:tconn:214-222",
      "note": "the fold: spaces, CRLF, then 1+ spaces"
    },
    {
      "title": "After unfolding",
      "lines": ["Set-Cookie: a=1; path=/ Max-Age=900"],
      "state": "ok",
      "cite": "diff:tconn:220",
      "note": "replaced by a single space"
    }
  ]
}
```

Caption: An obs-fold on the wire, and the value urllib3 now hands to callers. [[diff:tconn:214-222]]

```json
{
  "title": "Folded and unfolded header values"
}
```
