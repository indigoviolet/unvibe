The selected phrase describes the second job of `_normalize_header_values`. When any value changed, it removes every header from the `HTTPMessage` that `getresponse` received and adds them all back, normalized and in the original order. It does this on the same object, so the message keeps its identity. [[diff:src-urllib3-connection.py:102-108]]

The code does it in two loops over `header_items`, the list returned by `message.items()`:

1. `del message[name]` for each name. `HTTPMessage.__delitem__` removes every entry with that name, so a duplicate name is simply deleted twice and the second delete does nothing. [[diff:src-urllib3-connection.py:105-106]]
2. `message[name] = value` for each pair, in the original order. `__setitem__` appends, so duplicates and their relative order come back. This is my reading of the stdlib behaviour, and `test_normalize_header_values_preserves_message` confirms it for interleaved `Set-Cookie` entries. [[diff:src-urllib3-connection.py:107-108]] [[diff:test-test_connection.py:226-246]]

**Why all headers, not only the changed ones.** `message[name] = value` appends to the end. If only the folded `Set-Cookie` were deleted and re-added, it would move after `X-Second` and `b=2` and the order would change. Rewriting everything is what keeps the order stable. The author's choice of this approach is inferred, since the description doesn't discuss it. [[desc:d-p2]]

**What else was possible.**
- Edit the message's private header list directly. That is cheaper, but it depends on stdlib internals.
- Build a new `HTTPMessage`. That would break identity, and the socket test asserts `_original_response.headers is _original_response.msg`, which a replacement object could break. [[diff:test-with_dummyserver-test_socketlevel.py:141]]

**What it costs.**
- Every header on the message is rewritten even when only one changed.
- urllib3 mutates a stdlib object it doesn't own. The unit test limits the damage by checking that `defects`, `policy` and the payload keep their identity. [[diff:test-test_connection.py:247-249]]
- The rewrite only runs when `headers_changed` is true, so ordinary responses are never touched. [[diff:src-urllib3-connection.py:102]]

**What it is for.** The rewrite keeps `HTTPHeaderDict` and the original message identical, so no consumer sees a raw CRLF in either. The description says consumers such as Requests read the message. I haven't verified that, because Requests isn't in this repo. [[desc:d-p2]]

### Follow-ups

- Does re-adding preserve header-name case? | ask: When `_normalize_header_values` does `del message[name]` and then `message[name] = value`, is the header-name case preserved exactly, and which test would show it?
- Would deleting only the changed headers break ordering? | ask: Show a concrete case where deleting and re-adding only the folded header on the `HTTPMessage` would change header order.

```json
{"anchor": {"quote": "deletes and re-adds all headers on the same message object", "blockId": "central"}}
```