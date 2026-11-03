## The problem

Python's `http.client` leaves obsolete folded response header lines (`obs-fold`) inside the `HTTPMessage` values. A header sent as `Set-Cookie: a=b\r\n    c=d` therefore reaches urllib3, and anything downstream, with a raw `\r\n` in the value. RFC 9112 says a receiver must replace each such fold with spaces before interpreting the value.

::: example
```
wire:   Set-Cookie: ___utmvbtouVBFmB=gZg\r\n
            XbNOjalT: Lte; path=/; Max-Age=900\r\n

before: "___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900"
after:  "___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900"
```
This is the folded cookie the socket test sends. The four-space continuation line and its CRLF become one space. [[diff:test-with_dummyserver-test_socketlevel.py:101-102]] [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]
:::

::: simple
Some servers split one header over two lines. This is called `obs-fold`. It is an old HTTP habit. A folded header looks like `Set-Cookie: a=b\r\n    c=d`. The `\r\n` is a line break, and the second line starts with spaces.
:::

Before this change, `getresponse` built `HTTPHeaderDict` straight from `httplib_response.msg.items()`, so the raw CRLF went into both the `HTTPHeaderDict` and the original message. Consumers such as Requests read cookies from the original message, so they could re-emit the raw CRLF when they serialised the next request.

::: example
```python
# old line in getresponse
headers = HTTPHeaderDict(httplib_response.msg.items())
# items() still contains ("Set-Cookie", "a=1 \r\n two")
```
`msg.items()` hands over the folded value unchanged. The old code copied it into `HTTPHeaderDict` and left it in `msg` too. The unit test uses `"a=1 \r\n two"` as its folded `Set-Cookie`. [[diff:src-urllib3-connection.py:647-651]] [[diff:test-test_connection.py:229]]
:::

::: simple
Python's `http.client` does not clean this up. It leaves the line break inside the header value. So urllib3 receives a value with a raw `\r\n` in it, and so does any code that uses urllib3. RFC 9112 says a receiver must replace each fold with spaces before it uses the value.
:::

This is the folded `Set-Cookie` case from #1362. The whitespace-before-colon and header-name validation scope is not part of this problem.

::: simple
Before this change, `getresponse` built `HTTPHeaderDict` directly from `httplib_response.msg.items()`. So the raw line break ended up in two places: the `HTTPHeaderDict`, and the original `HTTPMessage`.
:::

```json
{"title": "The problem", "contribute": {"facts": []}}
```