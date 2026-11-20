`re.sub` is a left-to-right scan. It tries the whole pattern at offset 0. If the attempt fails, it moves to offset 1 and tries again, and so on. After a successful match it resumes at the end of that match. So any cost a failed attempt incurs is paid once per starting offset.

That matters for `_OBSOLETE_FOLD_RE` because its first element is an optional, greedy run of blanks. The pattern is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. [[diff:src-urllib3-connection.py:80-82]]

- A start offset inside a run of n blanks has no way to fail quickly without the lookbehind. `[ \t]+` takes every remaining blank, `\r\n` fails, and the engine gives back one blank at a time. Each time it retries `\r\n`, which fails again. Finally it skips the optional group, and `\r\n` fails on the blank itself.
- That is work proportional to the blanks left in the run. The scan then advances one offset and repeats the same work on a run that is one blank shorter. Summed over the run, this is n + (n−1) + … + 1, which is O(n²).
- The fast path in `_normalize_header_value` does not prevent this. It only checks that `\r\n` appears somewhere in the value, not that it follows the run. A value with a long blank run and a CRLF elsewhere still reaches the regex. [[diff:src-urllib3-connection.py:85-88]]

The lookbehind `(?<![ \t])` removes the repeated work without changing what matches. At the first blank of a run, the group may start and is tried once. At every later offset the previous character is a blank, so the lookbehind fails immediately. The optional group is skipped, `\r\n` fails on the next character, and that offset costs O(1). Each run is therefore tried once, and the total is O(n).

Dropping the later starts loses no matches. The group is greedy, so a match that starts mid-run could always have started at the run's first blank and swallowed the same text.

This serves the invariant that `_normalize_header_value` stays cheap on any header value a server sends. Header values come from the network, so a response with a long blank run could otherwise make unfolding quadratic. The comment above the regex states this intent. [[diff:src-urllib3-connection.py:80-82]]

No test checks it. The cases use blank runs of a few characters, so a quadratic version would return the same strings and pass. [[diff:test-test_connection.py:214-224]]

### Follow-ups

- Does the CPython regex engine already skip these offsets for this pattern? | ask: Does CPython's `re` module do any optimization, such as a literal-prefix or first-character check, that would make the pattern without the lookbehind faster than the O(n²) analysis suggests?
- Could a value with many folds, not one long run, still be slow? | ask: Is there an input with many short `\r\n` folds or many separate blank runs where `_OBSOLETE_FOLD_RE.sub` takes more than linear time?

```json
{"anchor": {"quote": "re.sub tries a match at every offset", "hostBlockId": "card:g-regex"}, "contribute": {"facts": [{"text": "re.sub retries the pattern at every start offset after a failed attempt, so the optional greedy blank run in _OBSOLETE_FOLD_RE would cost O(n) per offset inside a blank run without the lookbehind, and the _normalize_header_value fast path only checks that a CRLF appears somewhere in the value.", "citations": ["diff:src-urllib3-connection.py:80-82", "diff:src-urllib3-connection.py:85-88"]}]}}
```