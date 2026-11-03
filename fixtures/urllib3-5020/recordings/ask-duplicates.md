Everything in the final order comes from the second loop, which only appends. After the first loop empties the message, the append order is the only thing that decides where each header ends up. [[diff:src-urllib3-connection.py:105-108]]

- **No other positioning is available.** The first loop deletes every name, so the message is empty. `message[name] = value` is the only public call the code uses to put a header back. If it added entries in some other way, the original order and duplicates could not be rebuilt without touching private `HTTPMessage` internals. I'm going from memory of the stdlib (`email.message.Message.__setitem__` appends and allows repeated names under `compat32`) and haven't run it.
- **The order comes from the snapshot.** `header_items` is the list from `message.items()`, taken before any deletion. Re-adding it front to back gives the original sequence, with duplicates such as `Set-Cookie` in their relative order. [[diff:src-urllib3-connection.py:94]]
- **Appending is also why every header is rewritten.** If only the folded `Set-Cookie` were deleted and re-added, it would land after `X-Second` and `b=2`. Rewriting all of them keeps positions stable. The author's reason for this design is inferred, since the description doesn't discuss it.

What breaks if `__setitem__` behaved differently:

- If it replaced an existing entry, duplicate `Set-Cookie` values would collapse to one.
- If it inserted at the front, the order would reverse.

Either way `HTTPHeaderDict` would still be built from the correct `header_items` list, but the original `HTTPMessage` would no longer match it. That breaks the invariant that the two hold the same values in the same order. [[diff:src-urllib3-connection.py:650-651]]

`test_normalize_header_values_preserves_message` is the only check of this assumption. It interleaves two `Set-Cookie` entries with `X-First` and `X-Second`, then asserts that `message.items()` equals the expected list. It also asserts that `get_all("Set-Cookie")` returns both cookies. [[diff:test-test_connection.py:226-246]] It would catch a replacing or front-inserting `__setitem__`, but only for this one shape. A fold in the second duplicate, several folded headers, and a mixed-case name are not covered.

I couldn't place the selected sentence in the host block, so I answered from the question alone.

### Follow-ups

- What extra cases would harden the ordering test? | ask: Draft additional cases for `test_normalize_header_values_preserves_message` with two folded `Set-Cookie` duplicates, several folded headers, and a mixed-case name, with the expected `message.items()`.
- Is there a way to avoid depending on append behaviour? | ask: Could `_normalize_header_values` rebuild the message order without relying on `HTTPMessage.__setitem__` appending, and what would that cost?

```json
{"anchor": {"quote": "Only one unit test, with interleaved duplicates, checks this", "hostBlockId": "card:decisions"}}
```