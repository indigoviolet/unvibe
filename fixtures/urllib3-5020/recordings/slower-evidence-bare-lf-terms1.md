The fast path and the regex both key on `"\r\n"` — the two-character sequence carriage-return plus line-feed. A "bare LF" is a line ending with only the `\n`, no `\r` before it. A fold that ends in a bare LF is not matched by either, so it passes through unfolded. [[diff:src-urllib3-connection.py:86-88]]

This is read from `http.client`'s parser behaviour, not run here. `http.client` splits header lines on `\n`, so a line terminated only by `\n` is still read as a line, and the email parser then joins a continuation line into the value with whatever terminator that line had. For a bare-LF server, the value would contain `\n ` — a newline plus a space — and urllib3 would leave it untouched.

The changelog says the fix prevents "raw CRLF sequences", and the description says the `HTTPMessage` "no longer carries a raw CRLF after unfolding". Both claims are scoped to CRLF pairs, so the bare-LF case sits outside them either way. [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p6]]

The socket test sends only `\r\n` terminators. Its final assertion, that no value contains `\r` or `\n`, is therefore only established for CRLF input — it says nothing about what a bare-LF server would produce. [[diff:test-with_dummyserver-test_socketlevel.py:99-137]]

Nothing tests a lone `\n`, a lone `\r`, or a `\r\n` not followed by whitespace. Those are three distinct gaps: a bare line feed, a bare carriage return, and a CRLF at the very end of a value with no continuation after it.

```json
{"slower": {"cardId": "evidence-bare-lf"}}
```
