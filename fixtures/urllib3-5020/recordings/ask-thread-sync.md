The two views of one response are read by different code. `HTTPHeaderDict` is what urllib3 and its users read through `r.headers`. The original `HTTPMessage` is what outside consumers such as Requests read for cookies, according to the description. If only one were normalized, the same response would give two different answers depending on who asked. [[desc:d-p2]]

The cookie path is the reason it matters. Requests reads `Set-Cookie` from the original message. A raw CRLF still in that message could be re-emitted when the next request is serialized. Fixing only `HTTPHeaderDict` would leave that path broken. That Requests uses `_original_response.msg` comes from the description. I could not check it in Requests from here. [[desc:d-p2]]

The code does this in two steps inside `_normalize_header_values`:
- It builds the normalized `(name, value)` list, which `getresponse` hands to `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:94-100]] [[diff:src-urllib3-connection.py:650-651]]
- If any value changed, it deletes every header name from the message and re-adds each item in order. The message and the dict are then built from the same list. [[diff:src-urllib3-connection.py:102-110]]

Both views come from one list, so they cannot drift apart. The message keeps its identity, order and duplicates, so a cookie jar sees the same `Set-Cookie` sequence as before, only unfolded. [[diff:test-test_connection.py:226-249]]

The alternative is to normalize only the copy that goes into `HTTPHeaderDict`. That is simpler and leaves the `http.client` object alone. It leaves the two views disagreeing, which is the gap described above. The cost of the chosen design is that urllib3 now mutates an object owned by `http.client`. [[diff:src-urllib3-connection.py:102-108]]

One caveat: "identical" is only partly enforced by the tests. The socket test checks every header in the dict. For the original message it checks only `set-cookie`, `fold-mixed-repeated`, and `headers is msg`. [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]

### Follow-ups

- Which code besides Requests reads the original message? | ask: Which consumers of `_original_response.msg` would see raw CRLF if only HTTPHeaderDict were normalized?
- Could the two views still diverge? | ask: Can `message[name] = value` alter a value on re-add so that the HTTPMessage differs from the HTTPHeaderDict?

```json
{"anchor": {"quote": "keeps the message and the `HTTPHeaderDict` identical", "hostBlock": "This mattered for two reasons."}}
```