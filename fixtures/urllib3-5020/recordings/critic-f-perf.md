## Evidence

Description: it says the normalization uses a linear-time pattern for long field values. [[desc:d-p2]]

Code: a comment explains that starting the whitespace match at the beginning of a run avoids quadratic backtracking. [[diff:conn:80-82]]

Tests: no test uses a long value or a long run of spaces. [[diff:tconn:214-222]]

## Assessment

The pattern is correct today, but the property that makes it safe (the lookbehind) is easy to "simplify" away later, and response headers are untrusted input. A test that normalizes a value with a very long run of spaces, kept within a generous time limit, would protect it. This is a test gap, not a bug.

```json
{
  "title": "The linear-time claim has no test",
  "finding": {
    "confidence": "high",
    "summary": "The description and a comment rely on the pattern being linear-time, but nothing would catch a regression.",
    "suggestedComment": {
      "text": "Could we add a test that normalizes a value with a very long run of spaces, so a later simplification of this pattern can't bring back the quadratic case?",
      "diff": "diff:conn:80"
    }
  },
  "cardIds": ["fpf-ev", "fpf-as"]
}
```
