"Reach" here means every consumer the change can affect, including ones outside this checkout. Only the test code in this checkout touches `_original_response`, and the urllib3 source is not here — so the consumers below come from the PR description, not from code that could be read. The description says cookie consumers such as Requests read the original `HTTPMessage` instead of `HTTPHeaderDict`, and names the failure as them "re-emitting raw CRLF". [[desc:d-p2]]

That is why the change has two outputs. `getresponse` builds `HTTPHeaderDict` from the items that `_normalize_header_values` returns, and the same function also deletes and re-adds every header on `httplib_response.msg`. If only the `HTTPHeaderDict` were cleaned, `r.headers` would look correct while a reader going through `_original_response.msg` would still get a `Set-Cookie` with an `obs-fold` CRLF in it — and the bug would remain for exactly that reader. The inferred cost is that urllib3 now treats `msg`, an object it does not own, as its own to rewrite. [[diff:src-urllib3-connection.py:650-651]] [[diff:src-urllib3-connection.py:102-110]]

The socket test pins this contract from both sides. It asserts that `_original_response.headers is _original_response.msg` — the `is` check matters because `http.client.HTTPResponse` exposes the same `HTTPMessage` under both names, so mutating the message in place fixes both. Building a replacement `HTTPMessage` would not fix both unless the response were also repointed. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

This also explains why `_normalize_header_values` keeps the message's identity instead of building a new one: identity means any consumer that already holds a reference sees the change. The unit test checks that `defects` and `policy` are the same objects and that the payload survives — which matters for parsers that read `msg.defects`, or that check the policy when they re-serialize. [[diff:test-test_connection.py:226-249]]

What is not covered: no test uses a real cookie consumer. The Requests cookie-extraction claim is only in the description's verification notes. Ordering matters for cookie jars, because they usually read `get_all("Set-Cookie")` in order — and the unit test does check that duplicates stay ordered after the rewrite. [[desc:d-p5]] [[diff:test-test_connection.py:246]]

```json
{"slower": {"cardId": "g-reach"}}
```
