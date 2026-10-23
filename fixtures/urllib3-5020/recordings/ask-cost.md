Cheap in practice. Values without CRLF skip the regex [[diff:conn:86-87]], and the message is only rewritten when something changed [[diff:conn:102]]. The rewrite deletes headers by name, which scans the message each time, so it's quadratic in the number of headers. That only happens for folded responses, which are rare. The regex itself is linear in value length [[diff:conn:80-82]].

```json
{}
```
