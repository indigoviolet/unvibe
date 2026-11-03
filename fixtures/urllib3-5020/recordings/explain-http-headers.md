The claim is that Requests reads cookies from the original `HTTPMessage` (`httplib_response.msg`), not from urllib3's `HTTPHeaderDict`. The PR description is the only source for it. Nothing in this repo shows how Requests gets its cookies. Requests isn't in the repo, and I didn't check its source. [[desc:d-p2]]

The claim matters because it decides whether the change needs to touch the message at all.

- Before the change, `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()`. The folded value, with its raw `\r\n`, was copied into the `HTTPHeaderDict` and also left in the message. [[diff:src-urllib3-connection.py:647-651]]
- If cookie consumers read only `HTTPHeaderDict`, normalizing that one copy would be enough. If they read the message, a clean `HTTPHeaderDict` leaves them with the raw `\r\n`. They could then write it into the next request's `Cookie` header.
- This is why `_normalize_header_values` returns the normalized items and also deletes and re-adds every header on the same `HTTPMessage` object, but only when some value changed. [[diff:src-urllib3-connection.py:91-110]]

The repo has tests for the claim's consequences but not for Requests itself. The socket test checks that `_original_response.msg.get_all("set-cookie")` returns the unfolded cookies. It also checks that `_original_response.headers is _original_response.msg`, so there is one message object, not two copies. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]] The description lists an end-to-end Requests cookie check among its verification steps, and I haven't run it. [[desc:d-p5]]

The cost of the design is that urllib3 now mutates a stdlib object it doesn't own. If Requests turns out to read `HTTPHeaderDict`, the in-place rewrite would be unnecessary.

### Follow-ups

- Which attribute does Requests actually read cookies from? | ask: Which attribute of a urllib3 response does Requests read `Set-Cookie` from when it fills its cookie jar, and does it go through `_original_response.msg`?
- Would normalizing only `HTTPHeaderDict` be enough for urllib3's own consumers? | ask: Does anything inside urllib3 other than `HTTPHeaderDict` read header values from `httplib_response.msg`, so the in-place rewrite matters beyond Requests?

```json
{"anchor": {"quote": "Consumers such as Requests read cookies from the original message", "host": "card:problem#b2"}, "contribute": {"open_questions": ["Does Requests read Set-Cookie from the original HTTPMessage (_original_response.msg) rather than HTTPHeaderDict? Only the PR description says so; the repo does not contain Requests."]}}
```