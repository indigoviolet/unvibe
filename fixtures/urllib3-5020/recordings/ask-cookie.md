The folded cookie in the socket test becomes one value, `___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900`, and the second cookie stays separate [[diff:tsock:124-127]]. The continuation line looks like a header (`XbNOjalT: Lte`), which is exactly why a raw CRLF here is dangerous when the cookie is re-sent.

```json
{}
```
