## The problem

Some servers split one header over two lines. This is called `obs-fold`. It is an old HTTP habit. A folded header looks like `Set-Cookie: a=b\r\n    c=d`. The `\r\n` is a line break, and the second line starts with spaces.

Python's `http.client` does not clean this up. It leaves the line break inside the header value. So urllib3 receives a value with a raw `\r\n` in it, and so does any code that uses urllib3. RFC 9112 says a receiver must replace each fold with spaces before it uses the value. [[desc:d-p1]]

Before this change, `getresponse` built `HTTPHeaderDict` directly from `httplib_response.msg.items()`. So the raw line break ended up in two places: the `HTTPHeaderDict`, and the original `HTTPMessage`. [[diff:src-urllib3-connection.py:647-651]]

Some tools, such as Requests, read cookies from the original message. They could copy the raw line break into the next request they send. [[desc:d-p2]]

This change is about the folded `Set-Cookie` case from #1362. Header names with whitespace before the colon, and header-name validation, are a different problem. They are not covered here. [[desc:d-p4]]

```json
{"depth": {"level": "simple", "cardId": "problem"}}
```