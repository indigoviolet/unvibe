"Agree" means the `HTTPMessage` and the `HTTPHeaderDict` hold the same names, values, order and duplicates after `getresponse`. Neither is derived from the other, so the code makes them equal by building both from one list.

After `getresponse` the header data exists twice. `http.client` built the `HTTPMessage`, and `getresponse` copies it into an `HTTPHeaderDict`. If only the copy were unfolded, `r.headers` would be clean while `_original_response.msg` still held `\r\n`. A caller would then get a different answer depending on which one it read. [[diff:src-urllib3-connection.py:650-651]]

`_normalize_header_values` closes that gap in three steps:

1. It builds one list, `header_items`, from `message.items()`, with each value passed through `_normalize_header_value`. [[diff:src-urllib3-connection.py:94-100]]
2. If any value changed, it deletes every name from the message and re-adds every `(name, value)` from that same list, in order. [[diff:src-urllib3-connection.py:102-108]]
3. It returns the same list, and `getresponse` builds the `HTTPHeaderDict` from it. [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]]

Both objects therefore come from one list in one step. If nothing was folded, `headers_changed` stays false and the message is left alone. In that case the message is already equal to the list, so they still agree.

The invariant behind this is that no copy a consumer can reach may carry a fold, and the copies must not disagree with each other. Building both from `header_items` also avoids a second read of `msg` that could drift from the first.

The socket test checks this from both sides. It asserts the same unfolded `set-cookie` list on `r.headers.getlist(...)` and on `_original_response.msg.get_all(...)`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]]

The agreement is a snapshot at the moment `getresponse` returns. Nothing keeps the two in step if either is changed afterwards. Nothing in the diff is meant to do that.

### Follow-ups

- Can either copy be mutated later and drift from the other? | ask: After `getresponse` returns, if a caller mutates `r.headers` or `_original_response.msg`, does anything in this change keep them in sync?
- Why return `header_items` instead of re-reading `message.items()`? | ask: What could differ if `getresponse` built `HTTPHeaderDict` from a fresh `httplib_response.msg.items()` after the write-back instead of from the returned `header_items`?

```json
{"anchor": {"quote": "so the message and urllib3's HTTPHeaderDict agree", "hostBlock": "card:central"}}
```