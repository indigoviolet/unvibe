I did not run the parser, so I don't know yet whether a bare-LF fold leaves a raw newline in the value. I'm only moderately sure it does.

Here is what could go wrong. A line ending is usually two characters, `\r\n`. A bare-LF line ending is just `\n`. Python's `http.client` reads both kinds of line. This fix only looks for `\r\n`. So a bare-LF fold would pass through unchanged. A raw newline would then sit inside a `Set-Cookie` value, which is the problem this PR set out to fix. Some real servers do send bare-LF folds.

To check, send `http.client` a bare-LF folded response and look at the value it gives back. If it contains a raw `\n`, there are two ways to close the gap:

- Widen the pattern to `\r?\n`, and widen the early check too.
- Or say in the changelog that only CRLF folds are handled.

Then add one socket test for whichever behaviour you choose.

(comment on diff:src-urllib3-connection.py:86)

```json
{"depth": {"level": "simple", "cardId": "assessment-bare-lf"}}
```