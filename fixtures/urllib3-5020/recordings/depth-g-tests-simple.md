## What the tests cover and miss

The tests check the main fold cases well. They also check that the message keeps its order and its duplicate headers. They are weak on input that is not a proper `obs-fold`.

**Covered.** `_normalize_header_value` has four test cases:
- An ordinary value with a tab inside. It stays the same.
- Mixed spaces and tabs around the line break.
- Several folds in one value.
- Two folds in a row. They give two spaces (`"one  three"`), not zero. [[diff:test-test_connection.py:214-224]]

The unit test for `_normalize_header_values` checks that the order and the two `Set-Cookie` entries survive. It also checks that the payload is kept. It checks that `defects` and `policy` are the same objects as before. [[diff:test-test_connection.py:226-249]]

The socket test runs the whole path through `getresponse`. It sends:
- A folded `Set-Cookie`.
- Every space/tab pairing around the line break.
- A mixed and repeated fold.
- An ordinary header whose inner `\t` must stay.

It checks that `HTTPHeaderDict` and `_original_response.msg` agree. It also checks that no value contains `\r` or `\n`. [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

**Missed: a bare line break.** `_OBSOLETE_FOLD_RE` needs at least one space or tab after the `\r\n`. A value with `\r\n` and nothing after it passes the fast-path check, then the regex does not match, so the value comes out unchanged. No test checks this. A lone `\n` or `\r` is not tested either. `http.client` splits on line ends, so a real socket may never send this. But the helper takes any string, so a direct test would be cheap. [[diff:src-urllib3-connection.py:80-82]]

**Missed: the "nothing changed" path and the speed claim.** Every test that touches the message has at least one folded value. Nothing checks that `_normalize_header_values` leaves the message alone when no value changes. The `headers_changed` check exists to skip the delete-and-re-add loop in that common case. [[diff:src-urllib3-connection.py:102-108]]

The regex comment says the lookbehind prevents quadratic backtracking, which means the work grows with the square of the input. No test uses a long run of spaces. If someone later simplified the pattern, no test would fail. [[diff:src-urllib3-connection.py:80-82]]

**Missed: odd header names.** The helpers use `del message[name]` and `message[name] = value`, with names from `message.items()`. Every test name is a plain token, and names differ only by case. No test has two fields whose names differ only by case, or a name with unusual characters. Spaces before the colon are out of scope. [[desc:d-p4]]

Deleting a name is case-insensitive, so it removes every casing at once. No test checks that the re-added headers keep each original casing. [[diff:src-urllib3-connection.py:105-108]]

- Does `del message[name]` followed by re-adding keep each header's original name casing when two fields differ only in case?
- Can `http.client` ever hand `_normalize_header_value` a value with a CRLF that is not followed by whitespace?
- What test would catch a regression in the lookbehind?

```json
{"depth": {"level": "simple", "cardId": "g-tests"}}
```