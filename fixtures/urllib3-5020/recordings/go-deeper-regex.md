## How the lookbehind keeps the match linear

`_OBSOLETE_FOLD_RE` is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It has an optional leading OWS group, then the required CRLF, then required RWS. [[diff:src-urllib3-connection.py:80-82]] The leading group exists so that whitespace before the CRLF is swallowed into the replacement. Otherwise `"before \t\r\n\t  after"` would become `"before \t after"`, not `"before after"`. [[diff:test-test_connection.py:218]]

Without the lookbehind, `(?:[ \t]+)?\r\n` would be quadratic on a value like `"a" + " " * n + "b"` that also contains a CRLF elsewhere. `re.sub` tries a match at every offset. At each of the n offsets inside the run, `[ \t]+` would greedily consume the rest of the run and then give back one character at a time looking for `\r\n`. That is O(n) work per start and O(n²) overall. `(?<![ \t])` lets the group begin only at the first character of a run. At every later offset the lookbehind fails at once, the optional group is skipped, and `\r\n` fails on the next character. The run is scanned and backtracked once, so the cost is O(n). The code comment states this, and the reasoning checks out on paper. [[diff:src-urllib3-connection.py:80-82]]

The alternative would be to not require the OWS in the regex and strip trailing whitespace separately. For example, you could split on `\r\n` and then `rstrip`/`lstrip` each piece. That would be linear without regex tricks. The author's choice, whose reasons are inferred, keeps the whole rule in one `sub` call. The cost is a subtle pattern. `_normalize_header_value` also skips values that contain no `\r\n`, so ordinary headers never reach the regex. [[diff:src-urllib3-connection.py:85-88]]

The lookbehind inspects the original string, not the output of earlier matches. Take `"one\r\n \r\n\tthree"`. The first match is `"\r\n "`, and its greedy `[ \t]+` consumes the space. At the second `\r\n`, the preceding character is that already-consumed space, so the lookbehind blocks the OWS group and the second fold matches as plain `\r\n\t`. The result is two spaces, one per fold, and the unit test pins `"one  three"`. [[diff:test-test_connection.py:220]] So "adjacent folds collapse to one space, not zero" in the decisions card is imprecise. Each fold yields exactly one space, so a whitespace-only continuation line gives two. The other cases behave as expected. Mixed SP/HTAB runs on either side collapse into one space, and repeated folds in one value each become one space. [[diff:test-test_connection.py:218-219]] [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

No test exercises the linear-time claim. The cases are all short, so a regression to a quadratic pattern would still pass. A bare `\r\n` not followed by SP/HTAB never matches, because the trailing `[ \t]+` is required, and that case is also untested. [[diff:src-urllib3-connection.py:82]]

### Follow-ups
- Is there an input that is still superlinear with this pattern? | ask: Can you construct a header value, such as many CRLF-space pairs or long whitespace runs without CRLF, where `_OBSOLETE_FOLD_RE` backtracks more than linearly?
- What would a performance regression test for this look like? | ask: How would you write a test that fails if `_OBSOLETE_FOLD_RE` loses its lookbehind, without making the test timing-flaky?
- Why not split and strip instead of a regex? | ask: Would splitting on `\r\n` and stripping each piece give the same results as `_OBSOLETE_FOLD_RE` for all the cases in `test_normalize_header_value`?

```json
{"title": "The _OBSOLETE_FOLD_RE lookbehind"}
```