## No

A bare LF with no SP/HTAB after it should be left alone. It is not an `obs-fold`, so the rule has nothing to unfold there.

`_OBSOLETE_FOLD_RE` treats a line break as a fold only when whitespace follows it. The trailing `[ \t]+` is mandatory, and that is what separates a continuation from a line end [[diff:src-urllib3-connection.py:80-82]]. If the rule rewrote a line break with nothing after it, it would join two field lines into one value. That would be a new sanitizing policy, and the PR makes no such claim. The changelog and description only promise to unfold folds [[diff:changelog-1362.bugfix.rst:1-3]] [[desc:d-p1]].

The invariant here is that no copy of the headers a consumer can reach carries a fold. That invariant says nothing about a stray line break that isn't a continuation.

Two cases are easy to mix up:

- **Bare LF not followed by whitespace.** This should stay unchanged. It may also be unreachable. `http.client` splits field lines on `\n`, so a lone `\n` may never survive inside a stored value. I haven't checked this against the stdlib source or run it.
- **Bare-LF fold (`\n` followed by SP/HTAB).** This is a real gap. The early return in `_normalize_header_value` and the pattern both require the literal `\r\n`, so such a value would pass through untouched [[diff:src-urllib3-connection.py:86-88]]. This is the open bare-LF finding. Fixing it means recognising a bare-LF fold, not rewriting every `\n`.

Closing the bare-LF fold gap would mean changing the pattern to `\r?\n[ \t]+` and changing the guard to match. The trailing `[ \t]+` must stay mandatory. If it became `[ \t]*`, a lone `\n` would start merging lines, which is the risk you are asking about. Widening also makes bare LF a fold terminator, which is a leniency choice that needs its own tests.

No current test covers either case. Every parametrized input has whitespace after its CRLF or no CRLF at all [[diff:test-test_connection.py:217-220]]. So the "leave it alone" behaviour is unpinned. A one-line case like `"a\nb"` or `"a\r\nb"` with the value unchanged would pin it, and it would also fail if the trailing group were loosened.

### Follow-ups

- Does `http.client` ever store a lone `\n` inside a header value? | ask: When `http.client` parses a header line ending in a bare `\n` followed by a non-whitespace line, is the `\n` ever kept inside a stored value?
- What would a widened pattern need to pass? | ask: If `_OBSOLETE_FOLD_RE` became `\r?\n[ \t]+`, which unit and socket cases should be added so a lone `\n` stays unchanged and a bare-LF fold becomes one space?

```json
{"anchor": {"quote": "that case is also untested", "blockId": "g-regex"}, "contribute": {"open_questions": ["Does http.client ever keep a lone \\n (not followed by SP/HTAB) inside a stored header value, or does its line splitting make that input unreachable?"]}}
```