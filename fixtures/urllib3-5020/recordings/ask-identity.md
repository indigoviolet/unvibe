## Same object

The message is the same object that downstream code already holds. `_normalize_header_values` edits `httplib_response.msg` in place and builds no copy of it. `getresponse` passes that object in at [[diff:src-urllib3-connection.py:650]]. The rewrite then calls `del message[name]` and `message[name] = value` on the parameter it received, which is the same reference [[diff:src-urllib3-connection.py:102-108]].

The only new container is `header_items`. It comes from `message.items()`, which returns a fresh list of `(name, value)` tuples [[diff:src-urllib3-connection.py:94-100]]. That list is the one copy in play. It is what `HTTPHeaderDict` is built from [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]].

This is why anyone who already took a reference to `_original_response.msg` sees the clean values without doing anything. Because `.headers` and `.msg` are two names for one `HTTPMessage`, both names are fixed together [[diff:test-with_dummyserver-test_socketlevel.py:139-141]].

Two limits on what the tests prove:

- The unit test checks `message.items()` on the object it passed in, and checks that `defects` and `policy` are the same objects before and after [[diff:test-test_connection.py:236-249]]. That is evidence the message was not replaced, since a new `HTTPMessage` would have its own `defects` and `policy`.
- The socket test's `is` check shows that `.headers` and `.msg` are one object at the end. It does not show that this object is the one from before normalization. The code is what establishes that.

The rewrite is a delete-all, then re-add-all, on the live object. It is not atomic. A holder that reads the message during the rewrite would see it partly rebuilt. This only matters if another thread reads it, and I found nothing in the change that guards against that. In the normal flow the rewrite finishes inside `getresponse`, before the response is returned [[diff:src-urllib3-connection.py:650-654]].

The rewrite only runs when `headers_changed` is true [[diff:src-urllib3-connection.py:102]]. If no value was folded, the object is not touched at all.

### Follow-ups

- Can another thread observe the message mid-rewrite? | ask: Is there any code path where something other than `getresponse` holds the `HTTPMessage` while `_normalize_header_values` deletes and re-adds its headers?
- Does the unit test prove the message object itself is kept? | ask: Which assertion in `test_normalize_header_values_preserves_message` would fail if `_normalize_header_values` replaced the `HTTPMessage` with a new one?

```json
{"anchor": {"quote": "it deletes and re-adds the headers on the original message", "hostBlock": "card:central"}, "contribute": {"open_questions": ["Can any consumer read the HTTPMessage concurrently with the delete-and-re-add rewrite in _normalize_header_values?"]}}
```