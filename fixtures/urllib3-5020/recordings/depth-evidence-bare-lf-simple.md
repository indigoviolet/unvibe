The fast path and the regex both look only for `"\r\n"`. A fold that ends in a bare `\n` (a line feed with no carriage return) is not matched. [[diff:src-urllib3-connection.py:86-88]]

I did not run this. I am going by how `http.client` is known to work. It splits header lines on `\n`, so a line that ends in only `\n` is still read as a line. The email parser then joins a continuation line onto the value and keeps whatever line ending that line had. So a server that sends bare-LF folds would give a value containing `\n ` (a newline and a space). urllib3 would leave that value as it is.

The changelog says the fix prevents "raw CRLF sequences". The description says `HTTPMessage` "no longer carries a raw CRLF after unfolding". Both claims are only about CRLF, so the bare-LF case falls outside them. [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p6]]

The socket test sends only `\r\n` line endings. Its last check says no value contains `\r` or `\n`. That is only shown to hold for CRLF input. [[diff:test-with_dummyserver-test_socketlevel.py:99-137]]

Nothing tests a lone `\n`, a lone `\r`, or a `\r\n` that is not followed by a space or tab.

```json
{"depth": {"level": "simple", "cardId": "evidence-bare-lf"}}
```