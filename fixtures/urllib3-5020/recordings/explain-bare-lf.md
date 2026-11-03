The selected sentence isn't in the host block, so I couldn't place it. I took it to mean a `\r\n` with no space or tab after it. `_normalize_header_value` leaves such a value as it is.

A bare CRLF is not an `obs-fold`. `_OBSOLETE_FOLD_RE` ends in `\r\n[ \t]+`, so it needs at least one space or tab after the CRLF. Without that, the pattern finds no match. [[diff:src-urllib3-connection.py:82]]

The unchanged value reaches the rest of the code in two steps:

1. The fast path only checks `"\r\n" in value`. A value with a bare CRLF passes that check and goes to `_OBSOLETE_FOLD_RE.sub(" ", value)`. With no match, `sub` returns an equal string. [[diff:src-urllib3-connection.py:86-88]]
2. In `_normalize_header_values`, `normalized_value != value` is false, so `headers_changed` stays false. The delete-and-re-add path doesn't run for that value. [[diff:src-urllib3-connection.py:97-100]] [[diff:src-urllib3-connection.py:102]]

This serves the rule that only real folds are rewritten. The change replaces `OWS CRLF RWS` and nothing else, so it never invents or removes separators elsewhere in a value.

A value with a bare CRLF would keep its raw line break in both `HTTPHeaderDict` and the original `HTTPMessage`. That is a limit of the "no raw CRLF" invariant. I expect `http.client` to treat a CRLF without following whitespace as the start of a new header line. If so, such a value would rarely reach this code. I haven't run the parser, and no test sends this case. The tests only send CRLFs followed by whitespace. [[diff:test-test_connection.py:214-222]]

### Follow-ups

- Can a value with a bare CRLF reach `_normalize_header_value` at all? | ask: Would `http.client` ever leave a `\r\n` not followed by a space or tab inside an `HTTPMessage` value, or does the parser always split it into a new header?
- Which test would pin this behaviour? | ask: What unit case should be added to `test_normalize_header_value` to show that a `\r\n` not followed by a space or tab is returned unchanged?

```json
{"anchor": {"quote": "not followed by whitespace is untouched", "blockId": "card:decisions"}, "contribute": {"open_questions": ["Does http.client ever leave a CRLF not followed by SP/HTAB inside an HTTPMessage value, or does the parser always split it into a new header line?"]}}
```