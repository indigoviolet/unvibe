## Decisions and questions

**Decisions**

- **Clean the original message too, not just the copy.** `getresponse` fixes the `HTTPMessage` (`msg`) as well as `HTTPHeaderDict`. The other option was to clean only `HTTPHeaderDict`. That would leave the line break (CRLF) in `msg`, and Requests reads `msg` for cookies. The description gives this as the reason. The cost is that urllib3 now changes an object that belongs to Python's `http.client`. [[desc:d-p2]] [[diff:src-urllib3-connection.py:102-108]]
- **Delete every header, then add them back.** `HTTPMessage` cannot replace one item where it sits. So the code deletes all the headers and adds them back in the original order. The message stays the same object, and the order is kept. The reason for this choice is inferred. [[diff:src-urllib3-connection.py:105-108]]
- **Skip values with no CRLF, and keep the pattern fast.** Most headers have no `\r\n`, so the code returns them untouched. For long runs of spaces, a lookbehind (a check of the character just before) keeps the matching fast. The code comment says it avoids quadratic backtracking, meaning work that grows with the square of the length. [[diff:src-urllib3-connection.py:80-88]]
- **One space per fold.** RFC 9112 says each fold becomes one space. Two folds in a row therefore give two spaces, not one. The unit test pins `"one  three"`. [[diff:test-test_connection.py:218-220]]

**Invariants**

- After `getresponse`, no header value in `HTTPHeaderDict` or in `msg` should contain a fold CRLF. Only the socket test checks that the message and the dict agree. [[diff:test-with_dummyserver-test_socketlevel.py:135-146]]
- Header names, order, duplicates, payload, policy and defects stay as they were. The unit test checks this. [[diff:test-test_connection.py:226-249]]

**Known uncertainties**

- A `\r\n` that is not followed by a space or tab is left unchanged. No test covers this. Reading the code is enough to confirm it.
- `del message[name]` removes every header with that name. The loop repeats it for each copy of the name, which does no harm because deleting a missing name does nothing. The headers are added back in `header_items` order, so duplicates stay in order. [[diff:src-urllib3-connection.py:105-108]]
- The names come from `message.items()`. A name that contained a CRLF would not be changed, but no test tries this.

**Interfaces with reach**

- The new helpers are private to `connection.py`. The public API does not change.
- The effect shows in `HTTPResponse.headers` and in `_original_response.msg`, which Requests and others read. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

```json
{"depth": {"level": "simple", "cardId": "decisions"}}
```