## Who reads _original_response.msg

Only the test code in this checkout touches `_original_response`. The urllib3 source isn't here, so the consumers below come from the PR description, not from code I could read. The description says cookie consumers such as Requests read the original `HTTPMessage` instead of `HTTPHeaderDict`. It names the failure as them "re-emitting raw CRLF". [[desc:d-p2]]

::: simple
Only test code in this checkout touches `_original_response`. The urllib3 source is not here, so the readers named below come from the PR description, not from code I read. The description says cookie libraries such as Requests read the original `HTTPMessage`, not `HTTPHeaderDict`. It says the failure is that they "re-emit raw CRLF".
:::

::: deep
The evidence has limits, and they set how far the claims below can go. This checkout contains no urllib3 code that reads `_original_response`, and no Requests code. The tests are the only readers visible here. "Requests reads the `HTTPMessage`" therefore rests on the description alone. I have not checked it against Requests' source, so I treat it as a premise, not a verified fact.

The premise matters because of a structural fact. A response object exposes more than its documented attributes. It exposes everything reachable from it. `_original_response` is private only by convention. A downstream library that needs something the public surface lacks will reach through it, and the description says Requests does this for cookies. Once a consumer depends on it, the attribute is part of what urllib3 must keep correct, whatever its name says. The convention protects only the maintainer who can see every reader. Here the maintainer cannot.
:::

That is why the change has two outputs. `getresponse` builds `HTTPHeaderDict` from the items that `_normalize_header_values` returns. The same function also deletes and re-adds every header on `httplib_response.msg`. If only `HTTPHeaderDict` were cleaned, `r.headers` would look correct. A reader going through `_original_response.msg` would still get a `Set-Cookie` with an `obs-fold` CRLF in it, and the bug would remain for that reader. The inferred cost is that urllib3 now treats `msg` as a second public output. Its contents are part of the contract, not an internal detail. [[diff:src-urllib3-connection.py:650-651]] [[diff:src-urllib3-connection.py:102-110]]

::: simple
So the change has to clean two things. `getresponse` builds `HTTPHeaderDict` from the items that `_normalize_header_values` returns. The same function also deletes every header on `httplib_response.msg` and adds it back. Suppose only `HTTPHeaderDict` were cleaned. Then `r.headers` would look right. But anyone reading `_original_response.msg` would still get a `Set-Cookie` with an `obs-fold` CRLF in it. For that reader the bug would remain. I infer one cost: urllib3 now treats `msg` as a second output that people depend on. Its contents become part of the contract.
:::

::: deep
An invariant is only as strong as the weakest copy of the data. After `getresponse`, the header data lives in two places that nothing keeps in step. One is `HTTPHeaderDict`, built from the list `_normalize_header_values` returns. The other is `httplib_response.msg`, which the same function rewrites in place by deleting every name and re-adding every item. Both jobs run from one list, so the copies are equal at the moment the function returns.

Cleaning either copy alone breaks the invariant for someone:

- Clean only `HTTPHeaderDict`. Then `r.headers` looks correct, and any test that reads only `r.headers` passes. A reader of `_original_response.msg` still gets the `obs-fold` CRLF, and so does anything that re-emits it. This is the failure the description names.
- Clean only `msg`. Then Requests would be fine, but `r.headers` would carry the fold, so urllib3's own users would see it.

The cost follows from this. Before the change, `msg` was a by-product that urllib3 copied from and never altered. After it, `msg` is something urllib3 promises to leave clean. Every later change to how headers are parsed or copied must keep that promise, and any consumer of `msg` can start depending on it. That is a larger contract than the diff suggests, and the description does not say the author intended it. The reason for taking on that contract is inferred. The alternative, leaving `msg` alone, leaves the reported bug open for exactly the consumer the description names.
:::

The socket test pins this contract from both sides. It asserts that `_original_response.headers is _original_response.msg`, and that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` hold the unfolded values. The `is` check matters because `http.client.HTTPResponse` exposes the same `HTTPMessage` as both `.headers` and `.msg`. Mutating the message in place fixes both names. Building a replacement `HTTPMessage` would not, unless the response were also repointed. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

::: simple
The socket test checks this from both sides. It asserts that `_original_response.headers is _original_response.msg`. It also asserts that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` hold the unfolded values. The `is` check matters because `http.client.HTTPResponse` exposes one `HTTPMessage` under both names, `.headers` and `.msg`. Changing that message in place fixes both names. A new `HTTPMessage` would not, unless the response were also pointed at it.
:::

::: deep
Python names are references, not copies. `.headers` and `.msg` are two names bound to one `HTTPMessage`, which is why `is` holds. Mutating that object changes what both names show, because there is only one object. Binding a replacement to one name would leave the other pointing at the old, folded object. Fixing that means rebinding every name that refers to it, and you cannot enumerate the names other code has taken.

The two assertions are what stop a partial fix from passing, because each catches what the other misses:

- The `is` assertion fails if the two names ever diverge.
- The `get_all` and indexed assertions fail if the shared object is still folded.
- A test of values alone would pass for a fix that cleaned one name and left the other bound to a different object.
- A test of identity alone would pass for a message that was never cleaned.

Only the pair shows that there is one object and that it is clean.
:::

This also explains why `_normalize_header_values` keeps the message's identity instead of building a new one. Any consumer that already holds a reference sees the change. The unit test checks that `defects` and `policy` are the same objects and that the payload survives. That matters for parsers that read `msg.defects`, or that check the policy when they re-serialize. [[diff:test-test_connection.py:226-249]]

::: simple
This is also why `_normalize_header_values` keeps the same message object. Any code that already holds a reference sees the change. The unit test checks that `defects` and `policy` are the same objects and that the payload survives. That matters for code that reads `msg.defects`, or that checks the policy when it writes headers back out.
:::

::: deep
Identity is the only property that reaches holders you cannot see. A new message object, however faithful its contents, is invisible to everyone who already took a reference to the old one, and they would keep reading the folded values. Keeping the same object makes the change reach them without their cooperation.

The unit test checks more than `items()` because the payload, `defects` and `policy` are state of the message, not of any header. A rewrite could lose them and still return the right header list. Two of them are checked with `is`, which asks whether it is the same object, not whether the contents are equal. An equal but different `policy` would pass `==` and still be a different object to anyone holding the old one. That is the failure `is` catches. The reason a consumer cares: code that reads `msg.defects` expects the parser's findings, and code that serializes expects the original policy. The payload check covers the same loss on the body side.
:::

What is not covered: no test uses a real cookie consumer. The Requests cookie-extraction claim is only in the description's verification notes. Ordering matters for cookie jars, because they usually read `get_all("Set-Cookie")` in order. The unit test checks that duplicates stay ordered after the rewrite. [[desc:d-p5]] [[diff:test-test_connection.py:246]]

::: simple
What is not covered: no test uses a real cookie library. The Requests claim appears only in the description's list of checks. Order matters for cookie handling, because cookie jars usually read `get_all("Set-Cookie")` in order. The unit test checks that duplicate headers stay in order after the rewrite.
:::

::: deep
The whole case for mutating `msg` rests on a consumer that no test in this change runs. The description lists end-to-end Requests cookie extraction among its verification steps, but that is a claim about a manual run. Nothing in the suite fails if Requests stops reading `msg`, or reads it in a way this rewrite does not satisfy. The tests check the property the consumer needs, clean values on `msg`. They do not check that the consumer gets what it needs from it.

Order is the one consumer-facing property the unit test pins, with `message.get_all("Set-Cookie") == ["a=1 two", "b=2"]`. That assertion fails if the rewrite reorders the duplicates. Order is a property of the delete-then-re-add procedure as a whole, not of any single header: every item has to go back in its original sequence. Cookie jars read `get_all("Set-Cookie")` in order, and for cookies that share a name, order can decide which value wins.
:::

::: principle
A private attribute that a downstream consumer reads is part of the public contract in practice. When one fact is copied into several places, make the invariant true in every copy a consumer can reach. Change shared objects in place, because replacing an object helps only the holders you can reach.
:::

### Follow-ups

- Does anything in urllib3 itself, not Requests, read `msg` after `getresponse` returns? | ask: Which code paths in urllib3 read `_original_response.msg` or `.headers` after `getresponse`, and would they see the normalized values?
- What happens to a consumer that grabbed `msg` before the rewrite? | ask: Since `_normalize_header_values` deletes and re-adds headers in place, can any caller observe a half-rewritten `HTTPMessage`?
- Could `HTTPHeaderDict` be the only source of truth? | ask: What would it take for Requests to stop reading `_original_response.msg`, making the in-place mutation unnecessary?

```json
{"depth": {"level": "deep", "cardId": "g-reach"}}
```