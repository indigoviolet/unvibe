## The problem

Some HTTP servers still split one header value across several lines. This old style is called `obs-fold`. The next line starts with a space or tab. Python's `http.client` keeps the line break (`\r\n`) inside the stored value. urllib3 then copied that value unchanged into `HTTPHeaderDict`. A folded `Set-Cookie` header therefore reached other code with a `\r\n` inside it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

Before this change, `getresponse` built the headers with `HTTPHeaderDict(httplib_response.msg.items())`. It did no cleanup. Python's original header object, `HTTPMessage`, also stayed on the response as `_original_response.msg`. Cookie libraries such as Requests read that object directly. They could send the raw `\r\n` again on later requests. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]

The bug report is #1362. A different problem is not part of this change: spaces before the colon and header-name checks. [[desc:d-p4]]

```json
{"depth": {"level": "simple", "cardId": "card:problem"}}
```