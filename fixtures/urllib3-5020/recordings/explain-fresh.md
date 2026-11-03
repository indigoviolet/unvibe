The selection is the other way to make `msg` clean: build a new `HTTPMessage` from `header_items` and assign it to the response in place of the old one. The change doesn't do this. It edits the existing object instead.

**What a swap would involve.** `_normalize_header_values` would create an empty `HTTPMessage` and add each `(name, value)` from the cleaned list. `getresponse` would then bind it to the response. This is a real option. The old message is never modified, so there is no delete-then-re-add step. The new object would also pass through the same single list as `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:91-110]]

**Why the change edits in place.** The invariant is that no copy a consumer can reach carries an `obs-fold`. A swap only fixes the references you rebind.

- The old message stays folded. Anything that took a reference to `httplib_response.msg` before `getresponse` finished still holds it. The in-place rewrite fixes that object, so those holders see clean values without doing anything. [[diff:src-urllib3-connection.py:102-108]]
- One message sits under two names. The socket test asserts `_original_response.headers is _original_response.msg`. A swap would have to rebind both attributes, or they would point at different objects. In-place editing fixes both names because there is only one object. [[diff:test-with_dummyserver-test_socketlevel.py:139-141]]
- Message state beyond the headers would have to be copied by hand. A fresh `HTTPMessage` starts with its own `defects`, `policy` and payload. The unit test asserts that `defects` and `policy` are the same objects afterwards, and that the payload survives. A swap would fail those `is` checks unless the code also transplanted that state. [[diff:test-test_connection.py:247-249]]

**What the in-place edit costs.** The old message stays valid, but urllib3 now mutates an object it doesn't own. It also relies on `HTTPMessage` semantics. `del message[name]` removes every occurrence of a name, and `message[name] = value` only appends. So the loop must delete all names first and then re-add them in `header_items` order to keep interleaved duplicates in place. [[diff:src-urllib3-connection.py:105-108]]

**How firm the reasoning is.** The code comment says the aim is "preserving its identity and header ordering". [[diff:src-urllib3-connection.py:103-104]] The description doesn't discuss the swap alternative. That the author picked the in-place edit over a swap for these reasons is my inference. The swap isn't impossible. It would be workable if only `.msg` and `.headers` on that one response mattered. The in-place edit is the safer choice because urllib3 can't see who else holds the old object.

### Follow-ups

- Which attributes would a swap have to rebind to keep `.headers` and `.msg` identical? | ask: If `getresponse` replaced the `HTTPMessage` instead of mutating it, which attributes on `httplib_response` and the urllib3 response would need rebinding, and which tests would fail if one was missed?
- Could a fresh `HTTPMessage` preserve `defects` and `policy` without mutating the old one? | ask: How would a replacement `HTTPMessage` copy `defects`, `policy` and the payload from the old one, and would the unit test's `is` assertions still pass?

```json
{"anchor": {"quote": "build a fresh HTTPMessage and swap it", "hostBlock": "card:g-alt"}, "contribute": {"facts": []}}
```