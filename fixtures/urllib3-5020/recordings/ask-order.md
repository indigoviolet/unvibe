The rewrite has no other way to put a header back in a given position, so the order of the re-added headers is the order of the final `_headers` list. `message[name] = value` only appends, as I know `email.message.Message` from the stdlib (not re-read here). `del message[name]` removes every field with that name. Neither can replace one field in place. The loop is therefore delete everything, then replay `header_items` in sequence, and replaying is the only thing that sets the final order. [[diff:src-urllib3-connection.py:105-108]]

**What would break otherwise.** Take `X-First`, `Set-Cookie` (folded), `X-Second`, `Set-Cookie`. If the code fixed each name separately (delete `Set-Cookie`, re-add the cleaned value), the `Set-Cookie` fields would move to the end, and both would be gone from between `X-First` and `X-Second`. Deleting all names first leaves an empty message. Replaying `header_items` then rebuilds the original interleaving. The unit test pins exactly this with `message.items() == expected` and `get_all("Set-Cookie") == ["a=1 two", "b=2"]`. [[diff:test-test_connection.py:226-249]]

**What the replay also assumes.**
- `__setitem__` neither merges, replaces nor rejects a second field with the same name. I believe `compat32` has no duplicate limit, so it just appends. I haven't confirmed that here.
- Names come from `message.items()`, so each field is re-added with the casing it had. Case-insensitive `del` would mean differently-cased duplicates are removed together, but the replay restores them in order. That case is untested. [[diff:src-urllib3-connection.py:94-100]]

**Why it matters for the contract.** Cookie consumers read `get_all("Set-Cookie")` in order, and for cookies with the same name the order can decide which value wins. The rewrite has to leave `_original_response.msg` exactly as the server sent it, except for the unfolding. `HTTPHeaderDict` doesn't depend on this, because it is built from the returned `header_items` list, which already has the right order. Only the in-place message does. [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]]

**The cost.** Order preservation is a property of the whole loop, not of any one line. Someone could "simplify" it into a per-name rewrite and still pass the single-name checks. Only the interleaved case in the unit test would catch that. The delete step is also quadratic in the number of headers, though bounded by `http.client`'s header cap (I recall `_MAXHEADERS = 100`, unverified).

### Follow-ups

- Does the replay keep each name's original casing when fields differ only in case? | ask: If a response has "Set-Cookie" and "set-cookie" as separate fields, what does `_normalize_header_values` leave in the message and in `HTTPHeaderDict`?
- Which test fails if the loop re-adds per name instead of replaying `header_items`? | ask: If `_normalize_header_values` deleted and re-added one name at a time, which assertion in `test_normalize_header_values_preserves_message` would fail first?

```json
{"anchor": {"quote": "so duplicate names keep their order", "hostBlock": "card:g-alt"}, "contribute": {"open_questions": ["Does compat32 Message.__setitem__ always append without a duplicate check, and does re-adding preserve the original name casing when two fields differ only in case?"]}}
```