## How it's built up

The change has one plotline, and it has three pieces:

1. A pattern that finds a split header line, plus a small function, `_normalize_header_value`, that fixes one header value. If the value has no line break (CRLF), the function returns it at once. [[diff:src-urllib3-connection.py:80-88]]
2. A second function, `_normalize_header_values`, that fixes every header on the response. It changes the stored headers only if some value actually changed. It then hands back the cleaned list. [[diff:src-urllib3-connection.py:91-110]]
3. A call in `getresponse`. It passes the cleaned list to `HTTPHeaderDict`, which is urllib3's own header container. [[diff:src-urllib3-connection.py:647-651]]

The tests follow the same three layers. Unit tests check one value and then a whole message. For the message they check order, duplicate headers, the body text (payload), policy and defects. A socket-level test runs the whole path with a real network connection. The change also adds a changelog note. [[diff:test-test_connection.py:214-249]] [[diff:test-with_dummyserver-test_socketlevel.py:92-146]] [[diff:changelog-1362.bugfix.rst:1-3]]

```json
{"depth": {"level": "simple", "cardId": "buildup"}}
```