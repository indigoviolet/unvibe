## Evidence

The fast path and the regex only recognise CRLF folds. `_normalize_header_value` returns early unless `"\r\n"` is in the value. `_OBSOLETE_FOLD_RE` also requires `\r\n`. [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:80-82]]

`http.client` parses headers with the email parser under the `compat32` policy. As I recall, that policy keeps whatever line ending a continuation line had. It only strips a trailing `\r\n` from the whole value. I did not run it, so a server that folds with a bare `\n` (`Set-Cookie: a=1\n b=2`) would probably leave `"a=1\n b=2"` in the value. The fast path would skip it.

The tests only send CRLF folds. The final assertion checks that no `\r` or `\n` remains, but only for those inputs. [[diff:test-with_dummyserver-test_socketlevel.py:99-118]] [[diff:test-with_dummyserver-test_socketlevel.py:135-137]] The unit parametrization has no bare-LF case. [[diff:test-test_connection.py:214-222]]

The description and changelog say folded lines no longer leave raw line breaks in values. [[desc:d-p1]]

## Assessment

The invariant "no raw line break in header values" holds only for CRLF folds. A bare-LF fold would still put a raw `\n` into both `HTTPHeaderDict` and the original `HTTPMessage`, which is the same cookie re-emission hazard the PR targets. A hostile server controls the bytes, so this is reachable. Confidence is medium because I have not run the parser.

To close it, either:
- widen the pattern to `\r?\n`, or
- state that only CRLF folds are handled.

Add a socket-level case that sends a bare-LF fold either way.

## Evidence

The description says adjacent folds collapse to one space, not zero. [[desc:d-p6]] The unit test expects the opposite: `"one\r\n \r\n\tthree"` gives `"one  three"`, with two spaces. [[diff:test-test_connection.py:220]] The regex consumes one fold at a time, so each fold becomes its own space. [[diff:src-urllib3-connection.py:82]] [[diff:src-urllib3-connection.py:88]]

The comment on the regex claims it avoids quadratic backtracking for long values. [[diff:src-urllib3-connection.py:80-81]] No test sends a long whitespace run or a long folded value. The only inputs are short strings. [[diff:test-test_connection.py:214-222]]

## Assessment

The code is consistent with the RFC, which allows one or more SP per fold. The description is wrong about adjacent folds, and the test pins the two-space result. That is a documentation mismatch, not a bug.

The linear-time claim looks right from reading the lookbehind, but it is untested. This is a test gap, not a bug. To close it, correct the description wording. Optionally add a test with a long whitespace run, such as 100k spaces followed by `\r\n x`, or one with no fold, and assert it finishes quickly.

```json
{"findings": [{"title": "Bare-LF folds bypass unfolding", "confidence": "medium", "summary": "Only CRLF folds are detected, so a bare-LF fold would probably leave a raw newline in both HTTPHeaderDict and the HTTPMessage.", "suggestedComment": {"text": "The fast path and `_OBSOLETE_FOLD_RE` require `\\r\\n`. As far as I can tell, compat32 keeps a bare `\\n` fold inside the value, so a server sending `Set-Cookie: a=1\\n b=2` would still leave a raw newline in both representations. Should this be `\\r?\\n`, or is CRLF-only intended? Please add a socket-level case either way.", "diff": "diff:src-urllib3-connection.py:86"}, "cardIds": []}, {"title": "Adjacent-fold wording and untested linear-time claim", "confidence": "high", "summary": "The description says adjacent folds give one space but the test expects two; the no-quadratic-backtracking claim has no long-input test.", "suggestedComment": {"text": "The PR description says adjacent folds collapse to one space, but this case expects two (`\"one  three\"`). Please fix the description. Also, the regex comment claims linear time, so a long-whitespace-run test would back that up.", "diff": "diff:test-test_connection.py:220"}, "cardIds": []}]}
```