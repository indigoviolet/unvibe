A slower look at the same change, starting from what the reader already saw. An `obs-fold` is a header value an old server splits across two lines, with the second line starting after a line break (CRLF) plus whitespace. The change joins those halves back together right after parsing, before any other code reads the headers, because every consumer downstream would otherwise trip over the raw split on its own. [[diff:src-urllib3-connection.py:80-88]]

The joining is not one step but three, and the order matters. First the reader checks the value for any CRLF at all, which is the cheap fast path that skips clean values. Then the regex `_OBSOLETE_FOLD_RE` reads each split left to right: any spaces or tabs first, then the CRLF that ends the line, then the required whitespace that marks the next line as a continuation rather than a new header. Finally `_normalize_header_value` writes a single space where the match was, so the two halves become one value such as `a=1 path=/`. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

The same three steps run for every header on Python's `HTTPMessage`, one at a time and in arrival order, inside `_normalize_header_values`. When unfolding changes a value, the function deletes the old headers from the message object and adds the cleaned ones back in the same order, so the `HTTPMessage` and urllib3's `HTTPHeaderDict` hold the same clean values instead of disagreeing about what the server sent. [[diff:src-urllib3-connection.py:91-110]]

Concretely, in the order things happen:

1. The server sends `Set-Cookie: a=1`, then CRLF, then a space, then `path=/` — one cookie, split in two. [[diff:src-urllib3-connection.py:80-88]]
2. The fast path sees the CRLF and hands the value to the regex, which matches the trailing blank, the CRLF and the leading space as one fold.
3. The match becomes a single space, so the stored value reads `a=1 path=/`, and the write-back puts the cleaned header where the folded one was. [[diff:src-urllib3-connection.py:91-110]] [[diff:test-test_connection.py:218]]

::: example
```
value:   "a=1 \r\n path=/"
match:   " " + "\r\n" + " "   (one fold, three parts)
result:  "a=1" + " " + "path=/"  ->  "a=1 path=/"
```

This is the folded `Set-Cookie` the socket test reproduces byte for byte: the trailing space ends the first line, the CRLF ends it, and the leading space marks the continuation. One substitution replaces all three parts with a single space, so the cookie the downstream code reads is the joined value. [[diff:test-with_dummyserver-test_socketlevel.py:99-103]] [[diff:src-urllib3-connection.py:80-82]]
:::

```json
{"slower": {"cardId": "central"}}
```
