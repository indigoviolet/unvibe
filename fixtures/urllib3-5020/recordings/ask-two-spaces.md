Probably not designed, but it is pinned. The description says adjacent folds collapse to one space, and the code gives two, so the test records what the pattern happens to do. The author's intent is not stated, so "unintended" is my inference.

**What the code does.** For `"one\r\n \r\n\tthree"`, `_OBSOLETE_FOLD_RE` makes two non-overlapping matches. The first is `\r\n ` and its mandatory trailing `[ \t]+` takes the space. The scan resumes at the second `\r`, where there is no leading whitespace left to absorb. The second match is `\r\n\t`. Each match becomes one space, so the output is `"one  three"` [[diff:src-urllib3-connection.py:80-82]]. The lookbehind plays no part, since the optional group has nothing to match at a `\r` either way.

**What the author wrote.** The unit test expects two spaces [[diff:test-test_connection.py:220]]. The description lists "adjacent folds collapse to one space, not zero" as something to confirm [[desc:d-p6]]. The "not zero" half holds, but "one space" does not. The mismatch suggests the test was written from the pattern's output rather than from a stated rule. The other cases, with text between folds, give one space per fold, as expected. The socket test has no adjacent-fold case [[diff:test-with_dummyserver-test_socketlevel.py:112-114]].

**Whether it matters for the invariant.** The invariant is that no value reachable from the response keeps a raw CRLF, and `"one  three"` is a single line. As I recall RFC 9112, it allows replacing an obs-fold with one or more SP. I have not checked that against the text. If that is right, the output is conformant and the defect is in the description and test naming. The cost is a rule that is hard to guess: leading blanks are absorbed unless an earlier fold already took them.

**Closing it.** Either state "one space per fold" as the contract and rename the test case, or change the pattern so adjacent folds collapse to one space. The second option changes behaviour and needs its own tests, including a long blank run.

### Follow-ups

- What pattern would collapse adjacent folds to a single space? | ask: Would `(?:[ \t]*\r\n)+[ \t]+` give `"one three"` for `"one\r\n \r\n\tthree"` while keeping `"a\r\nb"` unchanged, and does it stay linear on long blank runs?
- Does any consumer care about one versus two spaces in a header value? | ask: Could a double space in an unfolded `Set-Cookie` value change cookie parsing in Requests or `http.cookiejar`?

```json
{"anchor": {"quote": "which collapse to two spaces", "blockId": "card:g-tests"}, "contribute": {"open_questions": ["Was the two-space result for adjacent folds a deliberate choice by the author, or an artifact the test later pinned?"]}}
```