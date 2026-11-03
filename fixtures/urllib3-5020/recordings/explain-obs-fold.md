A fold is a CRLF (`\r\n`) that is directly followed by at least one space or tab. The CRLF alone doesn't make it a fold. The whitespace after it is what tells the parser that the next line continues the previous header instead of starting a new one. RFC 9112 calls this `obs-fold`, which is optional whitespace, then CRLF, then required whitespace (OWS CRLF RWS).

That is exactly what `_OBSOLETE_FOLD_RE` matches. The required part is `\r\n[ \t]+`, and the leading `(?:(?<![ \t])[ \t]+)?` is the optional whitespace before the CRLF. Each match is replaced with a single space. [[diff:src-urllib3-connection.py:80-82]] [[diff:src-urllib3-connection.py:88]]

The "followed by whitespace" part has two consequences:

- **A CRLF with no whitespace after it is not a fold.** The pattern requires at least one space or tab, so `_normalize_header_value` leaves such a value alone. [[diff:src-urllib3-connection.py:82]]
- **The whitespace is consumed along with the CRLF.** The continuation line's leading whitespace, such as the four spaces in the socket test's `Set-Cookie`, disappears into the one replacement space. The result is `___utmvbtouVBFmB=gZg XbNOjalT: ...`. [[diff:test-with_dummyserver-test_socketlevel.py:101-102]] [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]

The detector only recognises `\r\n`. The fast path returns early unless `"\r\n"` is in the value. [[diff:src-urllib3-connection.py:86-87]] The critic finding about bare-LF folds is about this gap, and I haven't run the parser to confirm it.

### Follow-ups

- What happens to a value with `\r\n` that isn't followed by a space or tab? | ask: What does `_normalize_header_value` do with a value containing `\r\n` that is not followed by a space or tab, and can that still reach `HTTPHeaderDict`?
- Would a bare `\n` continuation line be unfolded? | ask: Does `_OBSOLETE_FOLD_RE` handle a continuation line that starts after a bare `\n` instead of `\r\n`, and what would http.client leave in the value?

```json
{"anchor": {"quote": "a line break followed by whitespace", "blockId": "card:problem"}}
```