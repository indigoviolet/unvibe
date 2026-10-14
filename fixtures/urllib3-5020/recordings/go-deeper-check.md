- Unfolds exactly the RFC shape: optional whitespace, CRLF, at least one space or tab. [[diff:conn:82]]
- [[page:f-lf|Folds that end in a bare LF are not unfolded]]. [[diff:conn:82]] [[diff:conn:86]]
- Order and duplicate headers are preserved when the message is rewritten. [[diff:tconn:238-246]]
- The original message keeps its identity, payload, defects and policy. [[diff:tconn:247-249]] [[diff:tsock:141]]
- [[page:f-perf|The linear-time claim has no test]]. [[diff:conn:80-82]]
- Tabs inside ordinary values are left alone. [[diff:tconn:217]] [[diff:tsock:133]]
- Two adjacent folds give two spaces, which RFC 9112 allows. [[diff:tconn:220]]

### Follow-ups

- Is the double space intended? | ask: two spaces

```json
{
  "title": "Review checklist",
  "cardId": "g-check"
}
```
