## Evidence

The fast path and the regex both key on the literal two-byte terminator `"\r\n"`, so a fold that ends in a bare `\n` is not matched. This is a claim about what the rewrite rule can see. A rule only protects inputs its pattern can recognise. The guard `"\r\n" not in value` and `_OBSOLETE_FOLD_RE` are two independent gates, and each one declines a bare-LF value on its own. A bare-LF value fails the guard, so it never reaches the regex. If it did reach the regex, the pattern's literal `\r` before `\n` would still reject it. Widening one gate therefore changes nothing, and a fix has to widen both together. [[diff:src-urllib3-connection.py:86-88]]

I did not run this, so each step below is a premise and not an observation.

1. `http.client` reads header lines one at a time, and its idea of a line is "ends at `\n`". A preceding `\r` is optional. The parser is lenient, so the bytes it accepts are a superset of what RFC 9112 calls well-formed. This is the only step I treat as a stable fact about the standard library.
2. The email parser joins a continuation line onto the value with that line's own terminator, so the sender's line ending is carried into the string as sent. I have not confirmed this.
3. A bare-LF fold would therefore reach urllib3 as `"...\n continued"`. That is a value with a line break in it, which is the shape of data this PR set out to remove, and urllib3 would leave it untouched.

If steps 2 and 3 hold, the parser accepts more line-end spellings than the normalizer recognises, and any input in that gap passes through unchanged. The invariant "a parsed value is one logical line" is then only as wide as the pattern's idea of a line end. A ten-line experiment against `http.client` would confirm or refute steps 2 and 3.

The changelog says the fix prevents "raw CRLF sequences", and the description says `HTTPMessage` "no longer carries a raw CRLF after unfolding". Both are scoped to CRLF, so the bare-LF case falls outside them. The prose is literally accurate, so this is not a mismatch between prose and code. The gap is in what the prose chose to promise. The stated purpose is that cookie consumers must not re-emit a raw line break, and for such a consumer `\n` and `\r\n` are equally harmful, because either can be written back out as a line break. A guarantee worded around one byte sequence is narrower than the harm it is meant to prevent. A reader may take "no raw CRLF" to mean "no raw line breaks", and the code does not support that wider belief. [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p6]]

The socket test sends only `\r\n` terminators. Its final assertion checks `\r` and `\n` separately, which would cover every line-break form. But an assertion is evidence only about the inputs that were run. Here the wide check passes because the input stays in the class the code handles. Given a bare-LF payload it would be a real test of the claim, and if the parser behaves as described above it would fail. Until that input is run, whether the check is vacuous for other terminators is unknown. [[diff:test-with_dummyserver-test_socketlevel.py:99-137]]

Nothing tests a lone `\n`, a lone `\r`, or a `\r\n` not followed by whitespace. These three inputs mark the edges of the rule, and they are different kinds of edge. The first two ask what counts as a line end, which decides whether the invariant is complete. The third asks what counts as a fold, which decides whether the rewrite is too eager. A suite that tests only well-formed folds can pass while the pattern is too narrow or too broad. No assertion would fail if the pattern widened to strip any CRLF, or if it ignored `\n` entirely, as it does now.

::: principle
A guarantee stated as "no X remains" needs a test for every spelling of X that the upstream parser can produce. Otherwise the test shows only that the one spelling you thought of is gone.
:::

```json
{"depth": {"level": "deep", "cardId": "evidence-bare-lf"}}
```