A rewrite rule is only correct if it changes exactly the inputs its definition covers. A bare LF with no SP/HTAB after it is outside the definition of an `obs-fold`, so the rule must leave it alone.

`_OBSOLETE_FOLD_RE` treats a line break as a fold only when whitespace follows it. The trailing `[ \t]+` is mandatory, and that is what separates a continuation from a line end. A line end terminates a field line, and the next line starts a new field. A continuation is part of the same value. The only evidence the pattern has for telling them apart is the byte after the break. [[diff:src-urllib3-connection.py:80-82]]

If the rule rewrote a line break with nothing after it, it would join two field lines into one value. The result would be a different message, not a cleaner one. That would be a new sanitizing policy, and the PR makes no such claim. The changelog and description only promise to unfold folds. [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p1]]

The invariant is that no copy of the headers a consumer can reach carries a fold. It has two halves, and a fix can break either:

- Every fold must go. If one survives, the bug stays open for some reader.
- Nothing that is not a fold may change. If it did, the rewrite would alter what the response means.

A stray line break that is not a continuation falls under the second half. It is not a violation of the first. The change was written to meet the first half. It should not touch the second.

Two cases are easy to mix up. They sit on opposite sides of that line:

- **Bare LF not followed by whitespace.** This is not a fold, so it must stay unchanged. It may also be unreachable. `http.client` splits field lines on `\n`, so a lone `\n` may never survive inside a stored value. I haven't checked this against the stdlib source or run it.
- **Bare-LF fold (`\n` followed by SP/HTAB).** This is a fold, so it belongs to the first half, and it is a real gap. The early return in `_normalize_header_value` and the pattern both require the literal `\r\n`. They are two independent gates, so each one declines such a value, and a value in the gap passes through untouched. This is the open bare-LF finding. Fixing it means recognising a bare-LF fold, not rewriting every `\n`. [[diff:src-urllib3-connection.py:86-88]]

Closing the bare-LF fold gap would mean changing the pattern to `\r?\n[ \t]+` and changing the guard to match. Widening only one gate changes nothing, because the other still declines the value. The trailing `[ \t]+` must stay mandatory. If it became `[ \t]*`, a lone `\n` would start merging lines, which is the risk you are asking about. Widening also makes bare LF a fold terminator. The RFC lets a recipient be lenient about that, so it is a policy choice and needs its own tests.

The alternative is to strip every raw `\n` and `\r` from values, whatever follows. It would close the bare-LF gap, but it is a different guarantee. It would change the meaning of malformed input, and nothing in this change argues for it. This reasoning is mine, because the description does not discuss the alternative.

No current test covers either case. Every parametrized input has whitespace after its CRLF, or no CRLF at all. The "leave it alone" behaviour is therefore unpinned. Tests that compare outputs on folded inputs only catch a rule that misses something it should change. They cannot catch one that changes something it should not. A one-line case such as `"a\nb"` or `"a\r\nb"`, with the value expected unchanged, would pin that side. It would also fail if the trailing group were loosened to `*`. [[diff:test-test_connection.py:217-220]]

::: principle
A rewrite rule has two obligations: change everything its definition covers, and change nothing else. Output checks on matching inputs show the first obligation only. The second needs inputs the rule must refuse, and a wider pattern should be adopted only together with such cases.
:::

- Does `http.client` ever store a lone `\n` inside a header value?
- What would a widened pattern need to pass?

```json
{"depth": {"level": "deep", "cardId": "ann_234c052cdadb"}}
```