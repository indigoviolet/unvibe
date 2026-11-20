An `obs-fold` — short for "obsolete folding" — is an old HTTP/1.1 habit where a server splits one header value over two lines: the value continues on the next line after a line break (CRLF) plus some whitespace. Python's `http.client` keeps those raw CRLFs inside the values of its header object, the `HTTPMessage` — that is the standard library's parsed representation of the response headers, one object holding every header. urllib3 then copied those values unchanged into its own `HTTPHeaderDict`, so a header such as a folded `Set-Cookie` reached consumers with an embedded `\r\n` still inside it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

Before the change, `getresponse` built the headers with `HTTPHeaderDict(httplib_response.msg.items())`, with no cleanup step in between. The original `HTTPMessage` stayed on the response as `_original_response.msg` — the untouched parse straight from the socket. Cookie consumers such as Requests read that message directly instead of urllib3's dict, so they could see the raw CRLF and even re-emit it on later requests. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]

The reported case is #1362. Whitespace before the colon and header-name validation are a separate issue and are not part of this change.

```json
{"slower": {"cardId": "problem"}}
```
