The "stated reason" is the sentence in the description that explains why the PR rewrites the `HTTPMessage` and not just `HTTPHeaderDict`. It says the two objects are kept in sync so that cookie consumers such as Requests don't re-emit a raw CRLF. [[desc:d-p2]]

Only the description says this. The code and tests never show how Requests reads cookies, and Requests isn't in this repo. Treat it as the author's claim, not as something the diff proves. The description also lists an end-to-end Requests cookie check as a verification step, which I haven't run. [[desc:d-p5]]

The claim decides whether the in-place rewrite is needed at all:

- **Before the change:** `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()`. The folded value reached both objects. [[diff:src-urllib3-connection.py:647-651]]
- **If consumers read only `HTTPHeaderDict`:** normalizing that one copy would be enough. The delete-and-re-add loop in `_normalize_header_values` would be extra work, and urllib3 would be mutating a stdlib object for no benefit.
- **If consumers read the original message:** a clean `HTTPHeaderDict` is not enough. They would still see the raw CRLF. That is the case the rewrite exists for. [[diff:src-urllib3-connection.py:102-108]]

The invariant behind it is that no consumer sees a raw CRLF, whichever of the two objects it reads. The in-repo evidence is the socket test, not Requests itself. It asserts that `_original_response.msg.get_all("set-cookie")` returns the unfolded cookies, and that `_original_response.headers is _original_response.msg`. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

That test shows the message is clean after `getresponse`. It does not show that Requests reads the message, which is the premise the whole design rests on.

### Follow-ups

- Which attribute does Requests read cookies from? | ask: Which attribute of a urllib3 response does Requests read `Set-Cookie` from when it fills its cookie jar, and does it go through `_original_response.msg`?
- Does anything inside urllib3 read the message directly? | ask: Does anything in urllib3 other than `HTTPHeaderDict` read header values from `httplib_response.msg`, so the in-place rewrite matters beyond Requests?

```json
{"anchor": {"quote": "stated reason is cookie consumers", "hostBlock": "card:decisions"}, "contribute": {"open_questions": ["Does Requests read Set-Cookie from the original HTTPMessage (_original_response.msg) rather than HTTPHeaderDict? Only the PR description says so; the repo does not contain Requests."]}}
```