## What the tests cover and miss

The tests exercise the whitespace combinations around the CRLF thoroughly, and they check that the message is preserved. They are thin on inputs that are not a well-formed `obs-fold`.

::: simple
The tests check the main fold cases well. They also check that the message keeps its order and its duplicate headers. They are weak on input that is not a proper `obs-fold`.
:::

::: deep
The change enforces one rule: a fold is OWS, CRLF, RWS, and each one becomes a single SP. A rule like this is a function with a domain split in two. A test suite has to pin both halves.

- **Inputs the rule must transform.** This is every way a well-formed fold can be spelled.
- **Inputs the rule must leave alone.** This is everything that resembles a fold but is not one.

A transformation can be wrong in two directions. It can miss something it should change, or it can change something it should not. Tests that compare outputs on folded inputs only ever catch the first error. Over-eagerness is invisible to them. For example, a trailing group loosened from `+` to `*` would still produce every expected output on the folded cases. Only an input that must stay unchanged can fail it.

The suite is strong on the first half and almost silent on the second.

::: principle
A test suite for a rewrite rule must contain inputs the rule has to refuse. Without them, widening the rule never fails a test.
:::
:::

**Covered.** `_normalize_header_value` is parametrized over four cases. The first is an ordinary value with an inner tab that passes through unchanged. The second is mixed SP/HTAB runs around the CRLF. The third is multiple folds in one value. The fourth is adjacent folds, which collapse to two spaces (`"one  three"`), one per fold, and not zero. The unit test for `_normalize_header_values` checks that a mixed list keeps its order and its duplicate `Set-Cookie` entries. It also checks that the payload is kept and that `defects` and `policy` are the same objects as before. The socket test covers the full path through `getresponse`. It sends a folded `Set-Cookie`, every SP/HTAB pairing around the CRLF, a mixed and repeated fold, and an ordinary header whose inner `\t` must survive. It asserts that `HTTPHeaderDict` and `_original_response.msg` agree, and that no value contains `\r` or `\n`. [[diff:test-test_connection.py:214-224]] [[diff:test-test_connection.py:226-249]] [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

::: simple
**Covered.** `_normalize_header_value` has four test cases:
:::

::: deep
Each layer of the change has a test at its own level, and each test pins the property that layer owns.

- **The single-value rule.** It is tested on bare strings, with no `HTTPMessage` involved, so a failure points at the pattern and nowhere else. The four cases span the rule's territory:
  - the identity case (an inner tab, no CRLF);
  - the whitespace-shape case (mixed runs on both sides);
  - the repetition case (several folds);
  - the boundary case (folds with nothing between them).
- **The boundary case.** It is the most informative one, because it pins an emergent behaviour that no line of the code states. The first match consumes the space after its CRLF. At the second CRLF the lookbehind sees that consumed space and keeps the optional leading group from absorbing it. The result is `"one  three"`: one space per fold, not one space and not zero. Nothing in the RFC forbids two spaces here, so the test records what the implementation does. It does not enforce a requirement.
- **The message-level synchronization.** Its test checks what `HTTPMessage` can silently lose when a message is rewritten: order, duplicate fields, payload, and the identity of `defects` and `policy`. The `is` checks matter because a replacement object that looks equal would pass `==` and still break every holder of the old reference.
- **The socket test.** It is the only one that proves the pieces connect. It checks that the dict and the original message agree, and that no value contains `\r` or `\n`. That last assertion is established only for the CRLF-terminated input the test sends. It says nothing about other line endings.
:::

**Missed: a bare CRLF.** `_OBSOLETE_FOLD_RE` requires at least one SP/HTAB after the CRLF. A value that contains `\r\n` but no following whitespace goes through the slow path and comes out unchanged. No test pins that behavior, so the fast-path guard and the "leave it alone" outcome are both untested. A lone `\n` or `\r` is also never exercised. In practice `http.client` splits on line ends, so this input may not be reachable from the socket. The unit helpers accept any string, though, so a direct test would be cheap. [[diff:src-urllib3-connection.py:80-82]]

::: simple
The unit test for `_normalize_header_values` checks that the order and the two `Set-Cookie` entries survive. It also checks that the payload is kept. It checks that `defects` and `policy` are the same objects as before.
:::

::: deep
Two separate mechanisms leave a CRLF alone, and the tests exercise only one of them.

1. The fast path, `"\r\n" not in value`, skips the regex entirely. The ordinary-value case reaches it, because it contains a tab and no CRLF.
2. The regex itself declines a CRLF that has no SP/HTAB after it. The trailing `[ \t]+` is mandatory, so `sub` finds no match and returns the string unchanged.

No test reaches the second mechanism. It needs a string that passes the fast path and then fails the pattern, such as `"a\r\nb"`. That input is the semantic boundary of the whole change. A CRLF followed by non-whitespace is a field-line end, not a fold. Rewriting it would merge two lines into one value. Loosening the trailing group, or adding a "strip any CRLF" fallback, would turn the fix into silent header merging, and every current assertion would still pass.

Reachability is a separate question. If `http.client` never produces such a value from a real socket, the socket test cannot cover it. That is an argument for a direct unit test, not for leaving the case untested. The helper's contract is "any `str`", and the contract is what the test should pin. The same holds for a lone `\n` or `\r`, which the pattern also leaves untouched.
:::

**Missed: the "unchanged message" path and the linear-time claim.** Every test that touches the message has at least one folded value. Nothing asserts that `_normalize_header_values` leaves the message alone when no value changes. The `headers_changed` guard exists so the delete-and-re-add loop is skipped in the common case. The regex comment claims the lookbehind prevents quadratic backtracking. No test feeds a long whitespace run to guard against that regression, so a later simplification of the pattern would not fail any test. [[diff:src-urllib3-connection.py:102-108]] [[diff:src-urllib3-connection.py:80-82]]

::: simple
The socket test runs the whole path through `getresponse`. It sends:
:::

::: deep
Both gaps share a cause. They are properties of a design choice, not of the output, so tests that compare outputs cannot see them.

- **The `headers_changed` guard.** If it were removed, the loop would delete and re-add every header on every response. The result would still be equal, and every test would pass. The cost would be silent mutation of unfolded messages. Any holder of the message would be exposed to a rewrite that did nothing. A test could pin the guard by wrapping or mocking the message and asserting that no `__delitem__` or `__setitem__` call happens when nothing changed. Checking the identity of the returned items would not do it.
- **The lookbehind.** It does not change which strings match. A version without it returns the same result for every short input. It differs only in running time on a long blank run. Only an input whose run is long enough to make the difference measurable can separate the two versions, and the current cases use runs of a few characters.

A regression test for the lookbehind has to avoid wall-clock thresholds, which are flaky. Two alternatives are to compare how the time grows between two input sizes, or to use a size at which a quadratic version is unmistakably slow while a linear one finishes instantly. Without such a test, the comment is the only thing protecting the pattern. A reader can delete the lookbehind as redundant, because nothing marks it as load-bearing.

::: principle
A property of how a result is computed, such as whether work was skipped or how the cost grows, is invisible to tests that only compare results. It needs a test that observes the process: a mock, a call count or a size sweep.
:::
:::

**Missed: header-name edge cases.** The helpers rewrite the message with `del message[name]` and `message[name] = value`, with names taken from `message.items()`. All test names are plain tokens, differing only in case. Nothing covers names that differ only by case but appear as separate fields, or a name with unusual characters. Whitespace before the colon is explicitly out of scope. Case-insensitive deletion, though, means that deleting one name removes every casing of it. Whether the re-added headers keep each original casing is not tested. [[diff:src-urllib3-connection.py:105-108]] [[desc:d-p4]]

::: simple
It checks that `HTTPHeaderDict` and `_original_response.msg` agree. It also checks that no value contains `\r` or `\n`.
:::

::: deep
The rewrite relies on one property of `HTTPMessage`: lookup and deletion are case-insensitive, while stored names keep the casing they arrived with. Two consequences follow from reading the code.

- **Deletion removes every casing.** `del message["Set-Cookie"]` also removes a field stored as `set-cookie`. The delete loop therefore clears every field of that name, whichever casing each had. This is why calling it once per occurrence is harmless.
- **Re-adding uses the stored names.** The second loop takes each `(name, value)` from `header_items`, which came from `message.items()`. Each item carries its own original casing, so casing should be preserved by construction.

"Should be preserved by construction" is an argument from the code, not a pinned behaviour. The tests never mix `Set-Cookie` and `set-cookie` as separate fields. The property therefore rests on the stdlib's behaviour and not on an assertion. If the stdlib ever normalized names on insertion, no test here would notice.

Names with unusual characters are the other half. The helper passes names through untouched, so what happens to them depends on `HTTPMessage`'s own handling. Whitespace before the colon is explicitly excluded as a separate rule on #1362.
:::

### Follow-ups

- Does `del message[name]` followed by re-adding keep each header's original name casing when two fields differ only in case? | ask: If a response has "Set-Cookie" and "set-cookie" as separate fields, what does _normalize_header_values produce for the message and for HTTPHeaderDict?
- Can `http.client` ever hand `_normalize_header_value` a value with a CRLF that is not followed by whitespace? | ask: Can a bare CRLF or lone CR/LF without following whitespace reach _normalize_header_value from a real socket response?
- What test would catch a regression in the lookbehind? | ask: What test would fail if the lookbehind in _OBSOLETE_FOLD_RE were removed, and how long would the whitespace run need to be?

```json
{"depth": {"level": "deep", "cardId": "g-tests"}}
```