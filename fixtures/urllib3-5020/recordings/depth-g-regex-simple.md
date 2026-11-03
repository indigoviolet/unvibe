## The _OBSOLETE_FOLD_RE lookbehind

`_OBSOLETE_FOLD_RE` is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It has three parts. First comes an optional group that matches spaces or tabs before the line break. Then comes the line break (`\r\n`). Last comes at least one space or tab. The first group is there so the blanks before the line break are replaced too. Without it, `"before \t\r\n\t  after"` would become `"before \t after"`. The wanted result is `"before after"`. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:218]]

The lookbehind `(?<![ \t])` keeps the regex fast. `re.sub` tries to match at every position in the string. Take a value like `"a" + " " * n + "b"` that has a line break somewhere else. Suppose the pattern had no lookbehind. At each of the n positions inside the run of spaces, the pattern would grab the rest of the run. Then it would give back one character at a time, looking for `\r\n`. That is about n steps for each start, so about n² steps in total. The lookbehind says the group may start only at the first character of a run. At every later position the check fails at once. The run is then scanned only once, so the cost is about n steps. The code comment says the same, and the reasoning holds on paper. [[diff:src-urllib3-connection.py:80-82]]

There was another way to do this: skip the leading blanks in the regex and strip them separately. For example, split on `\r\n`, then call `rstrip` and `lstrip` on each piece. That is also fast and needs no tricky pattern. The author kept the whole rule in one `sub` call. The reason is inferred, not stated. The price is a pattern that is hard to read. Also, `_normalize_header_value` returns early when a value has no `\r\n`, so ordinary headers never reach the regex. [[diff:src-urllib3-connection.py:85-88]]

The lookbehind looks at the original string. It does not look at what earlier matches produced. Take `"one\r\n \r\n\tthree"`. The first match is `"\r\n "`. Its `[ \t]+` takes the space. At the second `\r\n`, the character just before it is that taken space. So the lookbehind blocks the leading group. The second fold matches only `\r\n\t`. The result is two spaces, one for each fold. The unit test expects `"one  three"`. [[diff:test-test_connection.py:220]]

So the phrase "adjacent folds collapse to one space, not zero" in the decisions card is not exact. Each fold gives one space. A continuation line that holds only blanks therefore gives two spaces. The other cases work as you would expect. Mixed spaces and tabs on either side of a fold become one space. Repeated folds in one value each become one space. [[diff:test-test_connection.py:218-219]] [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

No test checks that the regex is fast. All the test values are short, so a slow version of the pattern would still pass. A `\r\n` with no space or tab after it never matches, because the last part of the pattern is required. That case has no test either. [[diff:src-urllib3-connection.py:82]]

### Follow-ups

- Is there an input that is still superlinear with this pattern? | ask: Can you construct a header value, such as many CRLF-space pairs or long whitespace runs without CRLF, where `_OBSOLETE_FOLD_RE` backtracks more than linearly?
- What would a performance regression test for this look like? | ask: How would you write a test that fails if `_OBSOLETE_FOLD_RE` loses its lookbehind, without making the test timing-flaky?
- Why not split and strip instead of a regex? | ask: Would splitting on `\r\n` and stripping each piece give the same results as `_OBSOLETE_FOLD_RE` for all the cases in `test_normalize_header_value`?

```json
{"depth": {"level": "simple", "cardId": "g-regex"}}
```