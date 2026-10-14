It mutates the existing `HTTPMessage` rather than replacing it, so anything holding a reference sees the clean values. The tests assert the message's `defects` and `policy` objects are unchanged [[diff:tconn:248-249]] and that `r._original_response.headers is r._original_response.msg` [[diff:tsock:141]].

```json
{}
```
