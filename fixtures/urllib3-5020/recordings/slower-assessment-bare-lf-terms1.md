The parser here is `http.client`'s header parser, and its behaviour on bare-LF input was read, not run — "unverified" means no test in this change executes that path. Confidence is medium: the reasoning follows the parser's documented line-splitting, but nobody watched it happen.

If it holds, the fix covers only one of two line-ending forms that `http.client` accepts. A line ending is the character sequence that terminates a header line; CRLF is the standard one and bare LF is the tolerated one. Some real servers send bare-LF folds, and those would still put a raw newline into `Set-Cookie` values — the exact symptom this change targets.

To close it, run `http.client` on a bare-LF folded response and see what the value contains. If it holds a raw `\n`, either widen the pattern to `\r?\n` — where the `\r` becomes optional — and widen the fast-path check to match, or state in the changelog that only CRLF folds are handled. Add one socket test for the chosen behaviour.

```json
{"slower": {"cardId": "assessment-bare-lf"}}
```
