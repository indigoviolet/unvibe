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

```json
{
  "title": "Folds that end in a bare LF are not unfolded",
  "finding": {
    "confidence": "medium",
    "summary": "http.client accepts header lines ending in LF alone, but the new code only looks for CRLF.",
    "suggestedComment": {
      "text": "http.client also accepts header lines that end in a bare LF, so a fold like `a=1\\n b=2` keeps its line break: both the `\"\\r\\n\" not in value` fast path and this pattern only look for CRLF. Would `\\r?\\n` here (and in the fast path), plus a test, make sense?",
      "diff": "diff:conn:82"
    }
  },
  "cardIds": ["flf-ev", "flf-as"]
}
```
