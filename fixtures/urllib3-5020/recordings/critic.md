## Evidence

Code: the fast path returns early unless the value contains `"\r\n"`, and the pattern requires `\r\n`. [[diff:conn:86-88]] [[diff:conn:82]]

Parser: `http.client` accepts header lines ending in a bare LF. Checked locally: parsing `Set-Cookie: a=1\n b=2` returns the value `'a=1\n b=2'`, which these helpers leave unchanged.

Tests: every fold in the socket test and the unit tests uses CRLF. [[diff:tsock:99-118]] [[diff:tconn:214-222]]

## Assessment

The invariant the PR states, no raw line breaks in header values, still fails for a folded value whose lines end in a bare LF. That's the same [[concept:header-injection|header injection]] risk through LF instead of CRLF. RFC 9112 lets recipients accept a bare LF as a line terminator, and `http.client` does. Broadening the pattern and fast path to `\r?\n`, plus one test, would close it. Confidence is medium: the maintainers may have left LF out deliberately, and it depends on `http.client`'s behaviour.

::: simple
A rarer kind of split header, using only LF, still keeps its line break. A small change to the pattern would cover it.
:::

::: deep
A sanitizer is only as strong as its coverage of the parser it follows: whatever line terminators the parser accepts, the sanitizer must also recognize. Here the parser is more permissive (CRLF or LF) than the sanitizer (CRLF only), so there's a gap between "accepted" and "cleaned".
:::

### Follow-ups

- Would rejecting folds be safer than unfolding? | ask: rfc

## Evidence

Description: it says the normalization uses a linear-time pattern for long field values. [[desc:d-p2]]

Code: a comment explains that starting the whitespace match at the beginning of a run avoids quadratic backtracking. [[diff:conn:80-82]]

Tests: no test uses a long value or a long run of spaces. [[diff:tconn:214-222]]

## Assessment

The pattern is correct today, but the property that makes it safe (the lookbehind) is easy to "simplify" away later, and response headers are untrusted input. A test that normalizes a value with a very long run of spaces, kept within a generous time limit, would protect it. This is a test gap, not a bug.

```json
{
  "findings": [
    {
      "id": "f-lf",
      "title": "Folds that end in a bare LF are not unfolded",
      "confidence": "medium",
      "summary": "http.client accepts header lines ending in LF alone, but the new code only looks for CRLF.",
      "suggestedComment": {
        "text": "http.client also accepts header lines that end in a bare LF, so a fold like `a=1\\n b=2` keeps its line break: both the `\"\\r\\n\" not in value` fast path and this pattern only look for CRLF. Would `\\r?\\n` here (and in the fast path), plus a test, make sense?",
        "diff": "diff:conn:82"
      },
      "cardIds": [
        "flf-ev",
        "flf-as"
      ]
    },
    {
      "id": "f-perf",
      "title": "The linear-time claim has no test",
      "confidence": "high",
      "summary": "The description and a comment rely on the pattern being linear-time, but nothing would catch a regression.",
      "suggestedComment": {
        "text": "Could we add a test that normalizes a value with a very long run of spaces, so a later simplification of this pattern can't bring back the quadratic case?",
        "diff": "diff:conn:80"
      },
      "cardIds": [
        "fpf-ev",
        "fpf-as"
      ]
    }
  ]
}
```
