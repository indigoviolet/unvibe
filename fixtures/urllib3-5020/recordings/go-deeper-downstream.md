## Effects on Requests and other consumers

Two objects come out of `getresponse` with header data: the `HTTPHeaderDict` on the urllib3 response, and the stdlib `HTTPMessage` (`httplib_response.msg`). Before the change both held the raw `\r\n`, because `HTTPHeaderDict` was built straight from `msg.items()`. [[diff:src-urllib3-connection.py:647-651]] Fixing only the `HTTPHeaderDict` would leave the second copy dirty. The description says cookie consumers such as Requests read the original message, so they would still see the CRLF and could re-emit it when serialising the next request. [[desc:d-p2]]

The change handles this by having `_normalize_header_values` write the normalized values back into the same `HTTPMessage` object. It deletes every header and re-adds them in order, and it does this only when some value changed. [[diff:src-urllib3-connection.py:102-108]] The message keeps its identity, so any reference a consumer already holds sees the unfolded values. The socket-level test checks this from the consumer side. It asserts that `r._original_response.msg.get_all("set-cookie")` returns the unfolded cookies and that `msg["fold-mixed-repeated"]` is `"one two three"`. It also asserts that `headers is msg`, so the response's `headers` attribute and its `msg` are the same object. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

The alternative was to leave the stdlib object alone and have consumers read `HTTPHeaderDict` only. That does not help Requests-style code that goes through `_original_response`. The reason for the in-place write is therefore the author's stated one: keeping the two views identical. [[desc:d-p2]] The cost is that urllib3 now mutates an object that belongs to the standard library. If the rewrite were skipped, the folded `Set-Cookie` from #1362 would reach a cookie jar with its CRLF intact.

The repository does not contain Requests. How Requests reads cookies, and how it serialises the next request, comes from the PR description, which lists end-to-end checks of both. [[desc:d-p5]] I did not verify those checks myself. The in-repo evidence is the two-view equality asserted in the socket test, not a Requests run.

### Follow-ups
- Why mutate the `HTTPMessage` instead of giving consumers only `HTTPHeaderDict`? | ask: Is there a way to unfold obs-fold for `_original_response.msg` consumers without deleting and re-adding every header on the stdlib HTTPMessage?
- What breaks if a consumer holds a reference to `msg` before `getresponse` returns? | ask: Can anything read httplib_response.msg between parsing and `_normalize_header_values` running, and would it see the raw CRLF?
- Does the delete-and-re-add rewrite preserve header-name case? | ask: Does `_normalize_header_values` preserve the original header-name case, and which test would show it?

```json
{"title": "Effects on Requests and other consumers"}
```