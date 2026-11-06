The author doesn't say why, so the reasons below are my inference. The description only says this is "intentionally" not addressed and that it belongs to a separate scope on #1362. [[desc:d-p4]]

**The two problems are in different parts of the field line.** An `obs-fold` is a fault in the field value. It leaves a `\r\n` inside the stored string, which is the single-line invariant this change restores. Whitespace before the colon is a fault in the field name. It puts no CRLF into any value, so it doesn't cause the folded-`Set-Cookie` symptom this PR targets.

**The code touches only values.** `_normalize_header_value` takes one value string, and `_normalize_header_values` takes the names from `message.items()` and writes them back unchanged. [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:94-108]] Handling the name side would need a different step: either rewrite the name or reject the response. That step would work on different data from the fold rewrite.

**The fixes have different risk.** Unfolding is lossless. As the card says, RFC 9112 defines the replacement, so it only restores the single-line form. [[diff:src-urllib3-connection.py:80-82]] For whitespace before the colon, I recall that RFC 9112 tells a server to reject it and a proxy to reject or remove it. That is from memory, not checked against the RFC text. If so, there is no equally clean client-side rewrite. Silently rewriting the name would change what the response means. Rejecting it would be a new error path and a policy choice. Keeping it out means this change can be judged against the `obs-fold` rule alone.

**Why that matters for the invariant.** The change enforces one rule: no fold survives in any copy of a value. A name-side rule would add a second contract to the same helpers. It would also need its own tests, and none of the tests here exercise names. [[diff:test-test_connection.py:214-249]]

**What isn't known.** I didn't check how `http.client` treats a field name followed by whitespace before the colon. I also didn't check whether it reaches `HTTPMessage` at all. If the parser already drops or flags such lines, that could be part of why the author left it out. That would be a guess.

### Follow-ups

- Does `http.client` store a header whose name has whitespace before the colon? | ask: When `http.client` parses `Set-Cookie : a=1`, what name does `HTTPMessage` store, and does it record a defect?
- What would handling the name side look like in this code? | ask: If `_normalize_header_values` also had to reject or rewrite names with whitespace before the colon, what would change in `getresponse` and which tests would it need?

```json
{
  "anchor": {"quote": "are a separate issue and are not part of this change", "hostBlockId": "card:problem"},
  "contribute": {
    "open_questions": [
      "Does http.client store, flag as a defect, or drop a header line with whitespace between the field name and the colon?"
    ]
  }
}
```