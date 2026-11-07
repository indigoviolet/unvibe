## Who reads `_original_response.msg`

Only the test code in this checkout touches `_original_response`. The urllib3 source isn't here, so the consumers below come from the PR description, not from code I could read. The description says cookie consumers such as Requests read the original `HTTPMessage` instead of `HTTPHeaderDict`. It names the failure as them "re-emitting raw CRLF". [[desc:d-p2]]

That is why the change has two outputs. `getresponse` builds `HTTPHeaderDict` from the items that `_normalize_header_values` returns. [[diff:src-urllib3-connection.py:650-651]] The same function also deletes and re-adds every header on `httplib_response.msg`. [[diff:src-urllib3-connection.py:102-110]] If only `HTTPHeaderDict` were cleaned, `r.headers` would look correct. A reader going through `_original_response.msg` would still get a `Set-Cookie` with an `obs-fold` CRLF in it, and the bug would remain for that reader. The inferred cost is that urllib3 now treats `msg` as a second public output. Its contents are part of the contract, not an internal detail.

The socket test pins this contract from both sides. It asserts that `_original_response.headers is _original_response.msg`, and that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` hold the unfolded values. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]] The `is` check matters because `http.client.HTTPResponse` exposes the same `HTTPMessage` as both `.headers` and `.msg`. Mutating the message in place fixes both names. Building a replacement `HTTPMessage` would not, unless the response were also repointed.

This also explains why `_normalize_header_values` keeps the message's identity instead of building a new one. Any consumer that already holds a reference sees the change. The unit test checks that `defects` and `policy` are the same objects and that the payload survives. [[diff:test-test_connection.py:226-249]] That matters for parsers that read `msg.defects`, or that check the policy when they re-serialize.

What is not covered: no test uses a real cookie consumer. The Requests cookie-extraction claim is only in the description's verification notes. [[desc:d-p5]] Ordering matters for cookie jars, because they usually read `get_all("Set-Cookie")` in order. The unit test checks that duplicates stay ordered after the rewrite. [[diff:test-test_connection.py:246]]

### Follow-ups
- Does anything in urllib3 itself, not Requests, read `msg` after `getresponse` returns? | ask: Which code paths in urllib3 read `_original_response.msg` or `.headers` after `getresponse`, and would they see the normalized values?
- What happens to a consumer that grabbed `msg` before the rewrite? | ask: Since `_normalize_header_values` deletes and re-adds headers in place, can any caller observe a half-rewritten `HTTPMessage`?
- Could `HTTPHeaderDict` be the only source of truth? | ask: What would it take for Requests to stop reading `_original_response.msg`, making the in-place mutation unnecessary?

```json
{"title": "Who reads _original_response.msg", "degraded": "The urllib3 and Requests source is not in the working copy, so the claim that Requests reads msg for cookies rests on the PR description. Nothing in the checkout confirms it."}
```