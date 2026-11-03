The "three pieces" are three layers, and each one has a single job. Splitting them this way lets you check each guarantee at the place where it is cheapest to check.

1. **What unfolding means for one value.** `_OBSOLETE_FOLD_RE` matches an `OWS CRLF RWS` run. `_normalize_header_value` returns the value unchanged when it has no `\r\n`. Otherwise it replaces each match with one space. [[diff:src-urllib3-connection.py:80-88]]
2. **Applying that to a whole message.** `_normalize_header_values` normalizes every `(name, value)` pair and returns the list. If any value changed, it also deletes and re-adds every header on the original `HTTPMessage`. [[diff:src-urllib3-connection.py:91-110]]
3. **Wiring it into the response path.** `getresponse` calls `_normalize_header_values(httplib_response.msg)` and builds `HTTPHeaderDict` from the returned items. Before the change it built `HTTPHeaderDict` straight from `msg.items()`. [[diff:src-urllib3-connection.py:650-651]]

The order is forced by dependencies. Layer 2 needs the single-value rule from layer 1. Layer 3 needs layer 2 to return the items and to rewrite the message. All of this protects one invariant: no consumer sees a raw CRLF, whether it reads `HTTPHeaderDict` or the original message. Layer 2 is the piece that makes the invariant hold for both. Layer 3 only decides where the invariant starts to apply. [[desc:d-p2]]

The tests follow the same split:

- **Unit tests.** They cover layer 1 with single-value cases, and layer 2 with a message check for order, duplicates, payload, policy and defects. [[diff:test-test_connection.py:214-249]]
- **Socket-level test.** It covers layer 3 end to end. Real bytes go through the `http.client` parser, and the test asserts on both `r.headers` and the original message. [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

The "three pieces" grouping is the guide's own framing. The diff has no such structure, because layers 1 and 2 sit in the same hunk. [[diff:src-urllib3-connection.py:80-110]]

### Follow-ups

- Could layers 1 and 2 be one function? | ask: Why are `_normalize_header_value` and `_normalize_header_values` separate functions, and what would be lost if they were merged?
- Which layer would a bare-LF fold fail in? | ask: If a header used a bare `\n` fold, which of the three layers would miss it, and where would a test for it belong?

```json
{"anchor": {"quote": "it builds up in three pieces", "block": "card:buildup"}}
```