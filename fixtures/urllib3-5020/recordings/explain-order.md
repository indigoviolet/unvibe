Re-adding the headers with `message[name] = value`, in the same order they came out of `message.items()`, rebuilds the header list in its original order. This works because `HTTPMessage.__setitem__` appends a new entry and never replaces an existing one. [[diff:src-urllib3-connection.py:107-108]]

I am reading the stdlib behaviour from memory here and have not run it. `HTTPMessage` is an `email.message.Message`. Its `__setitem__` adds a new header at the end, and it does not enforce a per-name limit under the `compat32` policy that `http.client` uses.

The sequence is:

1. `header_items` is a snapshot list from `message.items()`, so changing the message does not disturb the loops. [[diff:src-urllib3-connection.py:94]]
2. The first loop runs `del message[name]` for each name. This removes every entry of that name, so a duplicate such as `Set-Cookie` is cleared on its first delete. The second delete of that name does nothing. [[diff:src-urllib3-connection.py:105-106]]
3. The message is now empty. The second loop appends each `(name, value)` pair in snapshot order. Each append lands after the previous one, so the original sequence comes back, with duplicates in their relative order. [[diff:src-urllib3-connection.py:107-108]]

Appending is also why the code rewrites every header, not only the changed ones. If only the folded `Set-Cookie` were deleted and re-added, it would land at the end, after `X-Second` and `b=2`. Rewriting all of them in sequence is the only way to keep positions stable without touching private internals. The reason is inferred, since the description does not discuss it.

`test_normalize_header_values_preserves_message` supports this. It interleaves two `Set-Cookie` entries with `X-First` and `X-Second`, and asserts that `message.items()` equals the original order with the first cookie unfolded. [[diff:test-test_connection.py:226-246]]

This serves the invariant that header order and duplicates survive. That matters because `HTTPHeaderDict` and the original message must stay identical, and cookie order is observable. The test does not cover mixed-case header names, so whether the name's case survives the delete and re-add stays unverified.

### Follow-ups

- What would happen if `__setitem__` replaced an existing header instead of appending? | ask: If `HTTPMessage.__setitem__` replaced an existing header instead of appending, what would `_normalize_header_values` do to duplicate `Set-Cookie` entries?
- Is there a test that would fail if the second loop ran in reverse order? | ask: Which assertion in `test_normalize_header_values_preserves_message` would fail if the re-add loop iterated in a different order?

```json
{"anchor": {"quote": "appending in order", "hostBlock": "card:decisions"}}
```