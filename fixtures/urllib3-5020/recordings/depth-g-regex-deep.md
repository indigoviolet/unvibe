## The _OBSOLETE_FOLD_RE lookbehind

`_OBSOLETE_FOLD_RE` is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It has an optional leading OWS group, then the required CRLF, then required RWS. The leading group exists so that whitespace before the CRLF is swallowed into the replacement. Otherwise `"before \t\r\n\t  after"` would become `"before \t after"`, not `"before after"`. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:218]]

::: simple
`_OBSOLETE_FOLD_RE` is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It has three parts. First comes an optional group that matches spaces or tabs before the line break. Then comes the line break (`\r\n`). Last comes at least one space or tab. The first group is there so the blanks before the line break are replaced too. Without it, `"before \t\r\n\t  after"` would become `"before \t after"`. The wanted result is `"before after"`.
:::

::: deep
RFC 9112 defines an obs-fold as OWS, CRLF, RWS, and requires the recipient to replace the whole fold with one SP. The only way to follow that with a single `sub` is to make the pattern match exactly that span, so the pattern is the definition. If the leading OWS were left out of the match, the blanks before the CRLF would survive next to the substituted space, and `"before \t\r\n\t  after"` would become `"before \t after"`. The value would be single-line, so the no-CRLF invariant would hold. It would not be the canonical form the RFC defines, and two servers that fold the same value differently would produce different strings.

The trailing `[ \t]+` is required, not optional. A CRLF with no whitespace after it is not a fold. It is a line end, and the pattern must not touch it. The leading group is optional because a fold may begin directly at the CRLF. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:218]]
:::

Without the lookbehind, `(?:[ \t]+)?\r\n` would be quadratic on a value like `"a" + " " * n + "b"` that also contains a CRLF elsewhere. `re.sub` tries a match at every offset. At each of the n offsets inside the run, `[ \t]+` would greedily consume the rest of the run and then give back one character at a time looking for `\r\n`. That is O(n) work per start and O(n²) overall. `(?<![ \t])` lets the group begin only at the first character of a run. At every later offset the lookbehind fails at once, the optional group is skipped, and `\r\n` fails on the next character. The run is scanned and backtracked once, so the cost is O(n). The code comment states this, and the reasoning checks out on paper. [[diff:src-urllib3-connection.py:80-82]]

::: simple
The lookbehind `(?<![ \t])` keeps the regex fast. `re.sub` tries to match at every position in the string. Take a value like `"a" + " " * n + "b"` that has a line break somewhere else. Suppose the pattern had no lookbehind. At each of the n positions inside the run of spaces, the pattern would grab the rest of the run. Then it would give back one character at a time, looking for `\r\n`. That is about n steps for each start, so about n² steps in total. The lookbehind says the group may start only at the first character of a run. At every later position the check fails at once. The run is then scanned only once, so the cost is about n steps. The code comment says the same, and the reasoning holds on paper.
:::

::: deep
The lookbehind `(?<![ \t])` is a pruning device. It does not change what the pattern matches, only how much work the engine does. A backtracking matcher costs the sum, over start offsets, of the work done before a start fails. The optional group is greedy, so from any start inside a run it first takes the rest of the run and then backs off one character at a time. Each of those backoff steps re-tests `\r\n` and fails. That is O(k) for a start with k blanks left, and summed over a run of n blanks it is O(n²). The fast path does not help here, because the value contains a CRLF elsewhere.

The lookbehind removes the useless starts. `re.sub` reports the leftmost match, and any match that starts mid-run could also start at the run's first character, because the greedy group takes the whole run. A start mid-run can therefore never be the leftmost match, and rejecting it in O(1) loses no result. At a mid-run offset the lookbehind fails at once, the optional group is skipped, and `\r\n` fails on the next character, so each offset costs O(1). Each run is scanned and backtracked once, which makes the total O(n).

The cost of this design is that the lookbehind carries performance and no meaning. A later reader could delete it as redundant, and every functional test would still pass. The code comment states the intent, and the analysis above is on paper only. [[diff:src-urllib3-connection.py:80-82]]
:::

The alternative would be to not require the OWS in the regex and strip trailing whitespace separately. For example, you could split on `\r\n` and then `rstrip`/`lstrip` each piece. That would be linear without regex tricks. The author's choice, whose reasons are inferred, keeps the whole rule in one `sub` call. The cost is a subtle pattern. `_normalize_header_value` also skips values that contain no `\r\n`, so ordinary headers never reach the regex. [[diff:src-urllib3-connection.py:85-88]]

::: simple
There was another way to do this: skip the leading blanks in the regex and strip them separately. For example, split on `\r\n`, then call `rstrip` and `lstrip` on each piece. That is also fast and needs no tricky pattern. The author kept the whole rule in one `sub` call. The reason is inferred, not stated. The price is a pattern that is hard to read. Also, `_normalize_header_value` returns early when a value has no `\r\n`, so ordinary headers never reach the regex.
:::

::: deep
Split-and-strip is linear with no regex subtlety, but it is not equivalent. Splitting on `\r\n` also acts on a CRLF that is not followed by SP/HTAB, which is not an obs-fold and must be left alone. Stripping would also have to be confined to the pieces next to a real fold, so the code would need a second check to tell a fold from a line end. The one-pass `sub` avoids both problems because the fold definition is the pattern. Correctness then rests on one artifact, and performance on one lookbehind.

The author's reasons are inferred, since the description does not discuss the alternative. The trade is a harder-to-read pattern in exchange for one place that defines what a fold is. `_normalize_header_value` also returns early when a value has no `\r\n`. That is sound because the pattern needs a literal `\r\n` to match at all, so ordinary headers never reach the regex. [[diff:src-urllib3-connection.py:85-88]]
:::

The regex engine scans left to right, and each match consumes its trailing whitespace. Take `"one\r\n \r\n\tthree"`. The first match is `"\r\n "`, and its greedy `[ \t]+` consumes the space. The scan resumes at the second `\r`. No whitespace is left in front of it for the optional group to absorb, so the second fold matches as plain `\r\n\t`. The result is two spaces, one per fold, and the unit test pins `"one  three"`. So "adjacent folds collapse to one space, not zero" in the decisions card is imprecise. Each fold yields exactly one space, so a whitespace-only continuation line gives two. The other cases behave as expected. Mixed SP/HTAB runs on either side collapse into one space, and repeated folds in one value each become one space. [[diff:test-test_connection.py:220]] [[diff:test-test_connection.py:218-219]] [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

::: simple
Take `"one\r\n \r\n\tthree"`. The first match is `"\r\n "`. Its `[ \t]+` takes the space. The search then continues at the second `\r`. There is no blank left in front of it, so the second fold matches only `\r\n\t`. The result is two spaces, one for each fold. The unit test expects `"one  three"`.
:::

::: deep
Adjacent folds yield one space each because `re.sub` matches are non-overlapping and the first match consumes the whitespace. The lookbehind plays no part in this. Take `"one\r\n \r\n\tthree"`. The first match is `"\r\n "`, and its trailing `[ \t]+` takes the space. The scan resumes at the second `\r`. The optional group has nothing to match there, with or without the lookbehind, so the second fold matches as `\r\n\t`. The result is two spaces, one per fold, and the unit test pins `"one  three"`.

So "adjacent folds collapse to one space, not zero" in the decisions card is imprecise. The rule is one space per fold, and a continuation line that holds only blanks gives two. The other cases behave as expected. Mixed SP/HTAB runs on either side of a fold collapse into one space, and repeated folds in one value each become one space. Two spaces are acceptable under RFC 9112, which allows one or more SP. The fault is in the description's wording, not in the output. [[diff:test-test_connection.py:220]] [[diff:test-test_connection.py:218-219]] [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]
:::

No test exercises the linear-time claim. The cases are all short, so a regression to a quadratic pattern would still pass. A bare `\r\n` not followed by SP/HTAB never matches, because the trailing `[ \t]+` is required, and that case is also untested. [[diff:src-urllib3-connection.py:82]]

::: simple
Every test case is short. A slow version of the pattern would still pass them all. A line break with no space or tab after it is never matched, because the last part of the pattern is required. No test checks that either.
:::

::: deep
The performance property is the one guarantee in this change that has an owner (the lookbehind) but no test. A quadratic version is functionally identical and only differs on long blank runs, so only an input with a long run can tell the two apart. The unit and socket cases use runs of a few characters, where both versions finish instantly. Removing the lookbehind would leave every assertion green.

The bare-CRLF case is a separate gap. The required trailing `[ \t]+` makes the pattern leave a CRLF with no following whitespace unchanged. That is the intended behavior, since such a CRLF is a line end and not a fold. It is still unpinned, so loosening the trailing group to `*` would pass too. [[diff:src-urllib3-connection.py:82]]
:::

::: principle
When an optimization or a restriction in a pattern does not change what it matches, the test suite cannot see it. Either pin it with an input that separates the two versions, such as a long whitespace run, or accept that the next simplification will remove it unnoticed.
:::

### Follow-ups

- Is there an input that is still superlinear with this pattern? | ask: Can you construct a header value, such as many CRLF-space pairs or long whitespace runs without CRLF, where `_OBSOLETE_FOLD_RE` backtracks more than linearly?
- What would a performance regression test for this look like? | ask: How would you write a test that fails if `_OBSOLETE_FOLD_RE` loses its lookbehind, without making the test timing-flaky?
- Why not split and strip instead of a regex? | ask: Would splitting on `\r\n` and stripping each piece give the same results as `_OBSOLETE_FOLD_RE` for all the cases in `test_normalize_header_value`?

```json
{"depth": {"level": "deep", "cardId": "g-regex"}}
```