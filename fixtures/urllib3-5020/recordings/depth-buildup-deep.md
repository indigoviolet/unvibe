## How it's built up

The change is a single plotline, `obs-fold-unfolding`. Its pieces are layered so that each one carries exactly one guarantee, and the order of the layers is forced by the invariant they protect. That invariant is that no consumer ever sees a header value containing a raw CRLF.

1. **Per-value semantics.** The regex and `_normalize_header_value` define what unfolding means for one string. This layer has to be a pure function of the value. It is the only place the RFC 9112 rule (replace each `OWS CRLF RWS` with one space) is written down, so both views of the headers get the same answer. The `"\r\n" not in value` early return sits here too. It is safe because a fold cannot exist without a CRLF, and it keeps the regex off the common case. [[diff:src-urllib3-connection.py:80-88]]

2. **Per-message application.** `_normalize_header_values` applies the value rule to every header and writes the result back into the same `HTTPMessage`. It has to touch the message, and not only return a list. The headers exist in two places: the `HTTPHeaderDict` that urllib3 builds, and `httplib_response.msg`, which consumers can still reach through the original response. Fixing only one copy would leave the other violating the invariant. The in-place rewrite is delete-and-re-add, so order and duplicates survive. Rewriting only the changed headers would append them at the end, and the message would no longer match the wire order. [[diff:src-urllib3-connection.py:91-110]]

3. **Call-site placement.** `getresponse` calls the message-level function and builds `HTTPHeaderDict` from the returned items. The ordering matters. The call has to run before `HTTPHeaderDict` is constructed, and before the `HTTPResponse` is handed to anyone. If it ran later, there would be a window in which a reader could see a raw CRLF in one of the two views. Building the dict from the normalized items, not from `msg.items()` again, makes the two views agree by construction and not by coincidence. [[diff:src-urllib3-connection.py:650-651]]

The tests mirror the layers. Each one checks the layer it is cheapest to check at:

- **Unit tests.** They pin the value rule, including adjacent folds, which yield two spaces, one per fold. They also pin what the message-level rewrite must not disturb: order, duplicate fields, payload, and the identity of `policy` and `defects`. These properties cannot be seen from a header dict alone, so they need a hand-built `HTTPMessage`. [[diff:test-test_connection.py:214-249]]
- **Socket-level test.** It sends raw bytes, so the real `http.client` parser produces the folded values. It covers folded and duplicate cookies, every SP/HTAB combination around the CRLF, and repeated folds. It asserts on both `r.headers` and the original message, which checks the two-view invariant end to end. A unit test that built its own `HTTPMessage` could not show that the parser really delivers the folds in this shape. [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

A changelog fragment records the user-visible fix. [[diff:changelog-1362.bugfix.rst:1-3]]

What would break without this layering: with only layer 1 and a dict-only call site, `HTTPHeaderDict` would be clean while `msg` stayed dirty. With layer 2 but a call placed after the response is built, the two views would be briefly inconsistent. With a rewrite that did not preserve order or duplicates, cookie handling would change even for responses that had no fold.

::: principle
When the same data is exposed through two objects, fix it at the single point where both are derived, and derive one from the other. Then the two views cannot disagree.
:::

```json
{"depth": {"level": "deep", "cardId": "buildup"}}
```