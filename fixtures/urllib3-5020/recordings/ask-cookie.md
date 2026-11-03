Requests is the consumer the description names. It says Requests reads cookies from the original `HTTPMessage` (`httplib_response.msg`) rather than from `HTTPHeaderDict`. Nothing in this repo confirms that. Requests isn't here, and I haven't read its source. [[desc:d-p2]]

**The path the description implies.** Requests fills its cookie jar from the folded `Set-Cookie` value on the message. If the value still holds `\r\n`, the jar keeps it. On the next request the jar builds a `Cookie` header from that value, so the raw line break lands in the serialised request. The description lists an end-to-end check of cookie extraction and serialisation, which I haven't run. [[desc:d-p5]]

**Why the old code allowed it.** `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()` and left the message as it was. Both objects therefore held the folded value. [[diff:src-urllib3-connection.py:647-651]]

**How the fix stops it.**
- `getresponse` now calls `_normalize_header_values(httplib_response.msg)` and builds `HTTPHeaderDict` from the returned items. [[diff:src-urllib3-connection.py:650-651]]
- Each value that contains `\r\n` is run through `_OBSOLETE_FOLD_RE`. Each `obs-fold` becomes one space. [[diff:src-urllib3-connection.py:85-88]]
- If any value changed, the function deletes every header on the same `HTTPMessage` and re-adds the normalized ones in order. [[diff:src-urllib3-connection.py:102-108]]

After that, anything that reads the message sees the same clean value as `HTTPHeaderDict`. The socket test checks this. It asserts that `_original_response.headers is _original_response.msg`, that `msg.get_all("set-cookie")` returns the unfolded cookies, and that no header value contains `\r` or `\n`. [[diff:test-with_dummyserver-test_socketlevel.py:135-146]]

**What this serves.** The invariant is that no consumer sees a raw CRLF in a header value, whichever of the two objects it reads. Normalizing only `HTTPHeaderDict` would leave the message dirty. That is why the stdlib object is rewritten in place. The cost is that urllib3 now mutates an object it doesn't own.

**Limit.** The test shows the message is clean after `getresponse`. It does not show that Requests reads the message. That premise rests on the description alone. The fix also only recognises `\r\n` folds, as the bare-LF finding notes. [[diff:src-urllib3-connection.py:86-87]]

### Follow-ups

- Which attribute does Requests read cookies from? | ask: Which attribute of a urllib3 response does Requests read `Set-Cookie` from when it fills its cookie jar, and does it go through `_original_response.msg`?
- Would normalizing only `HTTPHeaderDict` be enough if Requests used it? | ask: If Requests read cookies only from `HTTPHeaderDict`, would the delete-and-re-add on `HTTPMessage` in `_normalize_header_values` still be needed?

```json
{"anchor": {"quote": "re-emit the raw CRLF", "host": "card:problem#b2"}, "contribute": {"open_questions": ["Which code path in Requests turns a Set-Cookie value from the original HTTPMessage into the next request's Cookie header, and does it keep an embedded CRLF? Only the PR description says so; Requests is not in the repo."]}}
```