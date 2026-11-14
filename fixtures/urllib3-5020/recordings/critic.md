## Evidence

The description says adjacent folds collapse to one space. The unit test expects two. The regex is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`, and the lookbehind only lets the optional leading whitespace match at the start of a whitespace run. [[diff:src-urllib3-connection.py:80-82]]

For `"one\r\n \r\n\tthree"`, the first match is `\r\n ` and becomes one space. The second fold then starts right after that match, where the preceding character is the space the first match just consumed. Because of the lookbehind, the second match cannot absorb that space. It matches only `\r\n\t` and becomes a second space.

The test pins the result as `"one  three"`, with two spaces. [[diff:test-test_connection.py:220]]

The description and the guide state a different behavior, "adjacent folds collapse to one space, not zero". That is not what the code does. [[desc:d-p6]] [[desc:d-p3]]

The socket test has no adjacent-fold case. Its mixed case, `one \t\r\n\t  two\t \r\n \tthree`, has non-whitespace between the folds. [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

## Assessment

This is a description/code mismatch, not a functional bug. RFC 9112 allows replacing each obs-fold with one or more SP, so two spaces is acceptable.

It still matters for two reasons:
- The checklist item "adjacent folds collapse to one space" would fail if someone ran it.
- The result depends on an asymmetry: whitespace before a fold is absorbed, but whitespace after a previous fold is not. A reader will not expect that.

To close it, either fix the description and test name to say "one space per fold", or change the regex so adjacent folds collapse to one space. A short comment on the test case would also help.

## Evidence

The fast path and the regex both key on `"\r\n"`. [[diff:src-urllib3-connection.py:86-88]] A fold that ends in a bare `\n` is not matched.

I read this from `http.client`'s parser behaviour and did not run it here. `http.client` splits header lines on `\n`, so a line terminated only by `\n` is still read as a line. The email parser then joins a continuation line into the value with whatever terminator that line had. For a bare-LF server, the value would contain `\n ` and urllib3 would leave it untouched.

The changelog says the fix prevents "raw CRLF sequences", and the description says `HTTPMessage` "no longer carries a raw CRLF after unfolding". Both claims are scoped to CRLF, so the bare-LF case is outside them. [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p6]]

The socket test sends only `\r\n` terminators. Its final assertion, that no value contains `\r` or `\n`, is therefore only established for CRLF input. [[diff:test-with_dummyserver-test_socketlevel.py:99-137]]

Nothing tests a lone `\n`, a lone `\r`, or a `\r\n` not followed by whitespace.

## Assessment

I did not run the parser here, so the bare-LF behaviour is unverified. Confidence is medium.

If it holds, the fix covers only one of two line-ending forms that `http.client` accepts. Some real servers send bare-LF folds. Those would still put a raw newline into `Set-Cookie` values, which is the exact symptom this PR targets.

To close it, run `http.client` on a bare-LF folded response and see what the value contains. If it holds a raw `\n`, either widen the pattern to `\r?\n` (and the fast-path check) or state in the changelog that only CRLF folds are handled. Add one socket test for the chosen behaviour.

```json
{"findings": [{"title": "Adjacent folds yield two spaces, contradicting the description", "confidence": "high", "summary": "The lookbehind in _OBSOLETE_FOLD_RE keeps a space left by an earlier fold from being absorbed, so 'one\\r\\n \\r\\n\\tthree' becomes 'one  three'. The description says adjacent folds collapse to one space.", "suggestedComment": {"text": "The test at this line expects two spaces for adjacent folds, but the PR description says adjacent folds collapse to one space. Please align the description or the regex, and explain the lookbehind asymmetry (whitespace before a fold is absorbed, whitespace after a previous fold is not).", "diff": "diff:test-test_connection.py:220"}, "cardIds": ["evidence-adjacent-folds", "assessment-adjacent-folds"]}, {"title": "Bare-LF folds are not unfolded, so raw newlines can still reach Set-Cookie", "confidence": "medium", "summary": "The fast path and regex only handle \\r\\n. http.client accepts \\n-terminated lines, so a bare-LF fold would keep a raw \\n in the value. Untested; the changelog and description claim only CRLF removal.", "suggestedComment": {"text": "http.client accepts lines ending in a bare \\n, so a folded header from such a server would leave '\\n ' in the value and skip both this fast path and the regex. Should the pattern use \\r?\\n? Please add a socket test with bare-LF folds, or state that only CRLF folds are handled.", "diff": "diff:src-urllib3-connection.py:86"}, "cardIds": ["evidence-bare-lf", "assessment-bare-lf"]}]}
```