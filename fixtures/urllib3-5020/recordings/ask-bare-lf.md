Leaving a bare LF that isn't followed by whitespace unchanged is correct for what this change claims to do. A different bare-LF case is a real gap, though.

**Why leaving it is right.** `_OBSOLETE_FOLD_RE` defines an `obs-fold` as optional whitespace, CRLF, then required whitespace, and the required trailing `[ \t]+` is what separates a fold from a line end ([[diff:src-urllib3-connection.py:80-82]]). A line break with nothing after it is a field-line terminator, not a continuation. If the rule rewrote it, it would merge two lines into one value. That would be a new sanitizing policy, not the RFC 9112 unfolding step. The author didn't claim that policy. The changelog and description both scope the fix to folds ([[diff:changelog-1362.bugfix.rst:1-3]], [[desc:d-p1]]). This is also why the bare `\r\n` case should be pinned by a test that expects no change.

**Two cases to keep apart.**

- **Bare LF not followed by SP/HTAB.** Leave it unchanged. It isn't a fold, so there is nothing to unfold. Whether `http.client` can hand such a value to the normalizer is unknown. Its parser splits field lines at `\n`, so a lone `\n` in a stored value may be unreachable. I haven't checked the stdlib source or run it.
- **Bare LF followed by SP/HTAB, which is a bare-LF fold.** This is the case the finding on bare-LF folds is about. Both gates key on the literal `\r\n`: the early return in `_normalize_header_value` and the pattern itself ([[diff:src-urllib3-connection.py:86-88]]). If `http.client` keeps a bare-LF fold's `\n ` inside the value, it passes through untouched. Whether it does is the unverified premise behind that finding.

**What widening would look like.** The real alternative is to recognize a bare-LF fold, not to rewrite every `\n`. That means changing the pattern to `\r?\n[ \t]+` and changing the guard to match. Widening only one of the two changes nothing, because the other still declines the value. The trailing `[ \t]+` must stay mandatory. Otherwise a lone `\n` would start merging lines, and that is the risk you are asking about.

**The cost of widening.** The RFC lets a recipient accept a bare LF as a line terminator, so this would be a policy choice about leniency. It would need its own tests, including a bare-LF fold and a lone `\n` that must stay intact. No current test covers either ([[diff:test-test_connection.py:217-220]]).

If you wanted to strip every raw `\n` and `\r` from values regardless of what follows, that would be a different guarantee with its own risks. It would change what the response means for malformed input, and nothing in this change argues for it. That choice is mine to flag, not the author's stated reason.

### Follow-ups

- Does `http.client` ever store a lone `\n` inside a header value? | ask: When `http.client` parses a header line ending in a bare `\n` followed by a non-whitespace line, is the `\n` ever kept inside a stored value?
- What would a widened pattern need to pass? | ask: If `_OBSOLETE_FOLD_RE` became `\r?\n[ \t]+`, which unit and socket cases should be added so a lone `\n` stays unchanged and a bare-LF fold becomes one space?

```json
{
  "anchor": {"quote": "that case is also untested", "block": "card:g-regex"},
  "contribute": {
    "open_questions": ["Does http.client ever keep a lone \\n (not followed by SP/HTAB) inside a stored header value, or does its line splitting make that input unreachable?"]
  }
}
```