The socket test proves the wiring and the real parser input. The unit tests prove neither, because they call the helpers directly with strings and messages the test builds itself.

- **`getresponse` actually calls the normalizer.** The unit tests import `_normalize_header_value` and `_normalize_header_values` and never go through `getresponse`. If the two lines that call `_normalize_header_values` and build `HTTPHeaderDict` from `header_items` were reverted, every unit test would still pass. Only the socket test would fail. [[diff:src-urllib3-connection.py:650-651]] [[diff:test-test_connection.py:226-249]]
- **The input is real wire bytes.** The unit test hand-writes `"a=1 \r\n two"` and puts it in an `HTTPMessage`. The socket test sends the folded `Set-Cookie` over a real connection (a continuation line starting with four spaces and no blank before the CRLF), so the value is whatever `http.client` really stores. The fixture also has all four SP/HTAB pairings and a mixed repeated fold, so it covers what the unit parametrization covers, now arriving through the parser. [[diff:test-with_dummyserver-test_socketlevel.py:99-118]]
- **The two copies agree on a real response.** It asserts the same unfolded `set-cookie` list through `r.headers.getlist(...)` and through `_original_response.msg.get_all(...)`. It also asserts that no value in `r.headers` contains `\r` or `\n`. The unit test checks the message alone, and only for the helper's own return value. This is the invariant that no copy a consumer can reach carries a fold. [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]
- **One object sits under both names.** `_original_response.headers is _original_response.msg` is checked on a real response. The unit test checks `defects` and `policy` identity on a standalone message, which doesn't show that the rewrite reaches both names. [[diff:test-with_dummyserver-test_socketlevel.py:139-141]]
- **Ordinary headers survive the full path.** `Ordinary: one\t two` and `Content-Length: 0` come through unchanged next to the folded ones. [[diff:test-with_dummyserver-test_socketlevel.py:133-134]]

**One limit on what it proves.** The test can't show that `http.client` was the thing leaving the `\r\n` in. I didn't run the parser. If a stdlib version unfolded values itself, this test would still pass, because the normalizer would then have nothing to do. It is consistent with the premise, but it doesn't isolate it.

**What it still doesn't cover:**
- Any bare-LF fold, because it only sends `\r\n`.
- A real cookie consumer such as Requests.
- Adjacent folds, because its mixed case has text between the folds.
- The linear-time claim.

[[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

### Follow-ups

- Which single revert would only the socket test catch? | ask: If `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()` again but `_normalize_header_values` was still called first, which unit and socket assertions would fail?
- Is there a way to prove `http.client` leaves the CRLF in? | ask: How could a test show that `http.client` itself keeps `\r\n` in a folded value, so the socket test fails if the stdlib starts unfolding?

```json
{"anchor": {"quote": "A socket-level test covers the whole path", "hostBlock": "card:buildup"}, "contribute": {"open_questions": ["Does the socket-level test pass on a stdlib that already unfolds values, i.e. does it isolate the normalizer's contribution at all?"]}}
```