## Assessment

I did not run the parser here, so the bare-LF behaviour is unverified. Confidence is medium.

::: simple
I did not run the parser, so I don't know yet whether a bare-LF fold leaves a raw newline in the value. I'm only moderately sure it does.
:::

::: deep
The finding rests on a chain of premises about `http.client`, and I checked none of them by running code. Each link is a separate claim about what the parser does:

1. The parser accepts a header line ended by `\n` alone.
2. It treats a following line that starts with SP or HTAB as a continuation and joins it onto the value.
3. The joined value keeps that line's own terminator, so a raw `\n` stays inside it.

The conclusion needs all three. If any one fails, the finding fails with it. The chain is also a conjunction, so my confidence in the whole is lower than my confidence in any single link. Medium means I trust the chain from what I know of the parser. It does not mean I observed the result. What a parser emits for a given byte sequence is a fact about behaviour. Reading about the parser or reasoning about it can make that fact likely, but only running it can settle it.
:::

If it holds, the fix covers only one of two line-ending forms that `http.client` accepts. Some real servers send bare-LF folds. Those would still put a raw newline into `Set-Cookie` values, which is the exact symptom this PR targets.

::: simple
Here is what could go wrong. A line ending is usually two characters, `\r\n`. A bare-LF line ending is just `\n`. Python's `http.client` reads both kinds of line. This fix only looks for `\r\n`. So a bare-LF fold would pass through unchanged. A raw newline would then sit inside a `Set-Cookie` value, which is the problem this PR set out to fix. Some real servers do send bare-LF folds.
:::

::: deep
The fix exists to guarantee one property: after parsing, a header value is a single logical line. A guarantee like that is only as wide as the set of inputs the normalizer recognises. It has to cover every spelling of a line end that the upstream parser accepts. If the parser accepts more spellings than the normalizer recognises, the guarantee holds only for the overlap. A value in the gap passes through unchanged, and nothing signals that it was missed.

The normalizer recognises exactly one spelling. The guard `"\r\n" not in value` and `_OBSOLETE_FOLD_RE` each require the literal pair `\r\n`. They are independent gates, so a bare-LF fold is declined twice. The guard returns the value early. If the value did reach the regex, the regex would still reject it, because the pattern has a literal `\r` before `\n`. Neither gate backs up the other here. They fail in the same direction.

The harm is the same as in the case the PR fixes. A consumer that re-emits `Set-Cookie` writes a raw `\n` back out as a line break, and `\n` ends a line just as `\r\n` does. The reported symptom is therefore still open for any server that folds with bare LF. Whether such servers matter in practice is an empirical question I did not answer.
:::

To close it, run `http.client` on a bare-LF folded response and see what the value contains. If it holds a raw `\n`, either widen the pattern to `\r?\n` (and the fast-path check) or state in the changelog that only CRLF folds are handled. Add one socket test for the chosen behaviour. [[diff:src-urllib3-connection.py:86]]

::: simple
To check, send `http.client` a bare-LF folded response and look at the value it gives back. If it contains a raw `\n`, there are two ways to close the gap:
:::

::: deep
Start with the experiment, because it decides whether anything else is needed. If the value comes back clean, the finding is void and nothing below applies. If it holds a raw `\n`, there are two real options. Each one is a statement about the contract, not only a code change.

- **Widen the recognition.** Change the pattern to `\r?\n` and change the guard too. Widening only one gate changes nothing, because the other still declines the value. This makes the guarantee match what the parser accepts. The cost is that bare LF is now treated as a fold terminator. That is a policy choice, so it needs its own tests. One of them must be a lone `\n` not followed by whitespace, which must stay unchanged. Otherwise the wider pattern could silently merge two header lines.
- **Narrow the claim.** State in the changelog that only CRLF folds are handled. This costs no code. It leaves the bug open for bare-LF servers, but it stops the prose from promising more than the code does.

The first option closes the hole and the second documents it. The reason to pick one is whether bare-LF servers are worth supporting, and I have no evidence either way.

Either way, one socket test should pin the chosen behaviour. Without it, nothing separates "handled" from "never exercised". The current final assertion (no `\r` or `\n` in any value) would pass only because the input never contained a bare LF.
:::

::: principle
A guarantee of the form "no X remains" is only as strong as the set of spellings of X it recognises. That set must be at least as wide as what the upstream parser accepts. When it is narrower, the gap is invisible to any test built from the spellings the author already had in mind.
:::

```json
{"depth": {"level": "deep", "cardId": "assessment-bare-lf"}}
```