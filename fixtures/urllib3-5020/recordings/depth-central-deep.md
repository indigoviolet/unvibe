## The central idea

`getresponse` now passes the parsed message through a new helper, `_normalize_header_values`, before it builds the `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:650-651]]

The rule behind the change is that one response should have one set of header values, whichever object reads them. The framing delimiter, CRLF, must not survive inside a field value, because anything that later writes the value back out can then forge a line boundary. Two objects hold the headers after parsing: urllib3's `HTTPHeaderDict` and the `http.client` `HTTPMessage`. If only one were cleaned, the invariant would hold for only some readers. The change therefore normalizes once, at the point where both are built, and makes both views agree.

For each value that contains `\r\n`, `_normalize_header_value` calls `_OBSOLETE_FOLD_RE`. It replaces each sequence of optional whitespace, CRLF and required whitespace with a single space. [[diff:src-urllib3-connection.py:80-88]]

- **Why a space:** that substitution is the RFC 9112 obs-fold rule as the description cites it. Replacing the fold with nothing would glue words together. Replacing only the CRLF would keep the surrounding whitespace, so the result would depend on how the sender padded the fold.
- **Why the `\r\n` check comes first:** it keeps the regex off the common case, where no fold exists.
- **Why one space per fold:** the unit test shows that adjacent folds each give one space, so `"one\r\n \r\n\tthree"` becomes `"one  three"`. That means the rewrite is applied per fold, not to the whole value. [[diff:test-test_connection.py:220]]

If any value changed, `_normalize_header_values` rewrites the original `HTTPMessage` in place: it deletes every header name, then re-adds every item in the original sequence. [[diff:src-urllib3-connection.py:102-110]]

- **Why the same object:** its identity is kept because other code, such as a cookie jar reading `_original_response.msg`, already holds a reference to it. Swapping in a new message would leave those holders with stale values. That cookie-jar use is the description's claim, which I did not check in Requests. [[desc:d-p2]]
- **Why order and duplicates survive:** `message[name] = value` appends, so re-adding every item in sequence restores the order, including repeated `Set-Cookie` lines. If only the changed headers were re-added, they would move to the end. The reason for delete-and-re-add over an in-place edit is inferred: `HTTPMessage` has no public setter for one occurrence of a repeated header.
- **Why only on change:** the rewrite runs only when `headers_changed` is true, so ordinary responses never mutate the `http.client` object.

The returned list feeds `HTTPHeaderDict` and the message receives the same items, so the two agree by construction rather than by two separate computations. [[diff:src-urllib3-connection.py:94-110]]

::: principle
Normalize untrusted input once, at the boundary where it becomes shared state. Every later view of it should be derived from that one result. Two independently cleaned copies can drift apart, and any reader of the uncleaned copy keeps the original hazard.
:::

```json
{"depth": {"level": "deep", "cardId": "card:central"}}
```