## Who reads _original_response.msg

Only test code in this checkout touches `_original_response`. The urllib3 source is not here, so the readers named below come from the PR description, not from code I read. The description says cookie libraries such as Requests read the original `HTTPMessage`, not `HTTPHeaderDict`. It says the failure is that they "re-emit raw CRLF". [[desc:d-p2]]

So the change has to clean two things. `getresponse` builds `HTTPHeaderDict` from the items that `_normalize_header_values` returns. The same function also deletes every header on `httplib_response.msg` and adds it back. Suppose only `HTTPHeaderDict` were cleaned. Then `r.headers` would look right. But anyone reading `_original_response.msg` would still get a `Set-Cookie` with an `obs-fold` CRLF in it. For that reader the bug would remain. I infer one cost: urllib3 now treats `msg` as a second output that people depend on. Its contents become part of the contract. [[diff:src-urllib3-connection.py:650-651]] [[diff:src-urllib3-connection.py:102-110]]

The socket test checks this from both sides. It asserts that `_original_response.headers is _original_response.msg`. It also asserts that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` hold the unfolded values. The `is` check matters because `http.client.HTTPResponse` exposes one `HTTPMessage` under both names, `.headers` and `.msg`. Changing that message in place fixes both names. A new `HTTPMessage` would not, unless the response were also pointed at it. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

This is also why `_normalize_header_values` keeps the same message object. Any code that already holds a reference sees the change. The unit test checks that `defects` and `policy` are the same objects and that the payload survives. That matters for code that reads `msg.defects`, or that checks the policy when it writes headers back out. [[diff:test-test_connection.py:226-249]]

What is not covered: no test uses a real cookie library. The Requests claim appears only in the description's list of checks. Order matters for cookie handling, because cookie jars usually read `get_all("Set-Cookie")` in order. The unit test checks that duplicate headers stay in order after the rewrite. [[desc:d-p5]] [[diff:test-test_connection.py:246]]

```json
{"depth": {"level": "standard", "cardId": "g-reach"}}
```

Correction: the requested level was `simple`, so the card above is wrong. Here is the simple version.

## Who reads _original_response.msg

Only test code in this checkout uses `_original_response`. The urllib3 source is not here. So the readers named below come from the PR description, not from code I read. The description says cookie libraries such as Requests read Python's original header object, the `HTTPMessage`. They do not read urllib3's `HTTPHeaderDict`. The description says the failure is that they "re-emit raw CRLF". That means they send the line break again. [[desc:d-p2]]

So the change cleans two things. `getresponse` builds `HTTPHeaderDict` from the cleaned items. The same function also deletes every header on `httplib_response.msg` and adds it back, cleaned. Suppose only `HTTPHeaderDict` were cleaned. Then `r.headers` would look right. But code that reads `_original_response.msg` would still get a `Set-Cookie` with a line break inside it. For that code the bug would remain. [[diff:src-urllib3-connection.py:650-651]] [[diff:src-urllib3-connection.py:102-110]]

The socket test checks both. It asserts that `_original_response.headers is _original_response.msg`. These are two names for one object. It also asserts that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` hold the cleaned values. Because the code changes the object in place, both names show the fix. A new object would not fix both names. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

That is why the code keeps the same message object. Any code that already holds it sees the change. The unit test checks that `defects` and `policy` are the same objects, and that the body text survives. [[diff:test-test_connection.py:226-249]]

What is not covered: no test uses a real cookie library. The Requests claim appears only in the description's list of checks. Cookie jars usually read `get_all("Set-Cookie")` in order. The unit test checks that duplicate headers stay in order. [[desc:d-p5]] [[diff:test-test_connection.py:246]]

```json
{"depth": {"level": "simple", "cardId": "g-reach"}}
```