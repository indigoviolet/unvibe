## The central idea

The change unfolds every `obs-fold` right after parsing, before anything reads the headers. `_OBSOLETE_FOLD_RE` matches optional whitespace, then CRLF, then required whitespace, and `_normalize_header_value` replaces each match with one space. [[diff:src-urllib3-connection.py:80-88]]

::: simple
Old servers sometimes split one header value over two lines. This is called an `obs-fold`. The change joins those lines back together right after the response is parsed, before any other code reads the headers. A regex called `_OBSOLETE_FOLD_RE` finds each split: optional spaces or tabs, then a line break (CRLF), then at least one space or tab. The function `_normalize_header_value` swaps each split for a single space. [[diff:src-urllib3-connection.py:80-88]]
:::

::: deep
In HTTP/1.x, CRLF is the framing delimiter. It ends one field line and starts the next. A parsed field value is only safe to hold, compare or re-serialize if it contains no framing bytes. `obs-fold` is the one historical exception, and RFC 9112 closes it. A recipient must replace each fold (OWS, CRLF, RWS) with a single SP before it interprets or forwards the value. That rule turns a wire-level quirk into an internal invariant: after parsing, a value is one logical line. [[diff:src-urllib3-connection.py:80-82]]

The pattern encodes the rule directly. It has an optional leading whitespace group, the required `\r\n`, and the required trailing whitespace. The whole fold is one match, so the whitespace on both sides is part of what gets replaced. Suppose the leading whitespace were left out of the match. Then `"before \t\r\n\t  after"` would keep its blanks before the CRLF and come out as `"before \t after"`, not `"before after"`. The value would still be single-line, but it would no longer be the RFC's canonical form. The lookbehind in the optional group only limits where that group may start, so matching stays linear. It does not change what a fold means. One consequence is that whitespace left by an earlier fold is not absorbed by the next one, so adjacent folds each yield one space. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:218-220]]

The invariant is enforced at the first point where the headers are held as plain strings. Enforcing it once there means no consumer has to defend against CRLF itself. If a consumer skipped its own check, it could write the CRLF back out as a line break in whatever it emits. The fast path is sound because the regex needs a literal `\r\n` to match at all. A value without one cannot change, so returning it untouched is equivalent to running the substitution. It only saves the regex scan for the ordinary headers that make up nearly all traffic. [[diff:src-urllib3-connection.py:85-88]]
:::

`_normalize_header_values` applies this to the `HTTPMessage` items. If any value changed, it deletes and re-adds the headers on the original message, so the message and urllib3's `HTTPHeaderDict` agree. It returns the cleaned items, and `getresponse` builds `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

::: simple
The function `_normalize_header_values` does this for every header on Python's own header object, the `HTTPMessage`. If a value changed, it deletes the headers from that object and adds them back in the same order. That way the `HTTPMessage` and urllib3's `HTTPHeaderDict` hold the same clean values. The function returns the cleaned headers, and `getresponse` builds the `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]
:::

::: deep
After `getresponse`, the same header data lives in two places. One is the `HTTPMessage` that `http.client` built, still reachable as `_original_response.msg`. The other is the `HTTPHeaderDict`, a snapshot copied from `msg.items()`. Neither is derived from the other after the copy, so nothing keeps them in step. The no-fold invariant therefore has to be made true in both, and the two must agree. [[diff:src-urllib3-connection.py:647-651]]

Each cheaper fix breaks the invariant for some holder.
- Cleaning only the dict leaves the fold in `msg`, which the description says cookie consumers such as Requests read. [[desc:d-p2]]
- Swapping in a new `HTTPMessage` leaves every existing holder of the old object, and its `defects` and `policy`, seeing folded values.
- Rewriting the same object in place is the only option here that reaches all holders, because the invariant has to hold on the object they already have. The unit test pins this by asserting that `defects` and `policy` are the same objects afterwards. [[diff:src-urllib3-connection.py:102-108]] [[diff:test-test_connection.py:248-249]]

`HTTPMessage` has no operation that replaces an item at its position. `del message[name]` removes every occurrence of a name, and `message[name] = value` appends at the end. Order and duplicates can therefore only be kept by deleting all the names first and then re-adding every item in its original sequence. That restores interleaved duplicates, such as two `Set-Cookie` fields around another header. The loop calls `del` once per occurrence, which is harmless because deleting an absent name is a no-op. The author's reason for choosing this approach is inferred, not stated. [[diff:src-urllib3-connection.py:105-108]] [[diff:test-test_connection.py:226-246]]

The rewrite runs only when `headers_changed` is true, so responses without folds never mutate the message. The function returns `header_items`, so `HTTPHeaderDict` is built from the data that was just written back. It is not built from a second read of `msg`, which could drift from it. Both copies then come from one list in one step. [[diff:src-urllib3-connection.py:94-102]] [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]]
:::

::: principle
Enforce an input invariant once, where the data first becomes structured. Enforce it in every copy that leaves that point, and produce those copies from a single source so they cannot disagree.
:::

```json
{"depth": {"level": "deep", "cardId": "central"}}
```