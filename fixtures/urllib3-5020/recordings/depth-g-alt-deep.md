## Mutating msg vs. only the dict

The invariant is that no header value reachable from the response may contain a fold CRLF, and every reachable copy must agree. After `getresponse` there are two copies of the header data. One is the `HTTPMessage` that `http.client` built, still exposed as `_original_response.msg`. The other is the `HTTPHeaderDict`, a snapshot taken from `msg.items()` at one moment. Neither is derived from the other afterwards, so nothing keeps them in step. Consumers choose a copy independently, and urllib3 cannot see which one. The description says Requests reads the `HTTPMessage`, and that decides the design. Cleaning only the dict makes `r.headers` look correct, but a reader of `msg` still gets the raw CRLF and can re-emit it. Cleaning `msg` after the dict was built would leave the dict folded. Both copies must be clean, and they must come from the same cleaned data. Otherwise what a caller sees depends on which attribute it reads. So `_normalize_header_values` also writes the cleaned values back into the message. The socket test checks agreement from both sides. It asserts the dict's `set-cookie` list, then the same list through `_original_response.msg.get_all("set-cookie")`. A test that read only one copy would pass with the other still broken. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p2]] [[diff:src-urllib3-connection.py:102-108]] [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]

The write-back deletes and re-adds every header on the same `HTTPMessage` object. The alternative is to build a fresh `HTTPMessage` and swap it onto the response. A reference to a Python object is a promise that you will see later changes to it. Replacing the object breaks that promise for everyone who already holds the old one. You can repoint names you control, but you cannot reach references others have already taken. Two facts make identity matter here:

- `http.client.HTTPResponse` exposes one `HTTPMessage` under both `.headers` and `.msg`. The socket test pins this with `_original_response.headers is _original_response.msg`. Mutating in place fixes both names at once. A replacement would have to repoint both and still could not update references held elsewhere.
- The message carries state beyond its header list: the payload, `defects` and `policy`. A fresh `HTTPMessage` starts with none of it, and copying it across is extra work that can go wrong. The unit test asserts `message.defects is defects` and `message.policy is policy`, so the author treated that state as part of the identity to preserve.

Delete and re-add fits this constraint because `HTTPMessage` has no operation that replaces an item at its position. The code comment states the aim as "preserving its identity and header ordering". That the author chose this mechanism over a swap for these reasons is my inference. The description does not discuss the alternative. [[diff:test-with_dummyserver-test_socketlevel.py:141]] [[diff:test-test_connection.py:248-249]] [[diff:src-urllib3-connection.py:103-104]]

A third option is to enforce the rule at the parse, by patching `http.client.parse_headers` or subclassing the response class. In principle this is the strongest placement. If values were unfolded where the message is built, no snapshot could ever carry the fold, and no synchronization code would be needed. The price is scope. `parse_headers` is a module-level stdlib function, so patching it changes behavior for every `http.client` user in the process, including code unrelated to urllib3. A library should not do that as a side effect of being imported. A subclass avoids the global effect but ties urllib3 to how `http.client` constructs responses. Normalizing after `begin()` inside `getresponse` limits the blast radius to code urllib3 owns. The cost is that the rule is enforced after the first copy exists, which is why both copies need handling. No code in this change tries the parse-level fix and no reason for rejecting it is stated, so this ranking is my inference.

The main cost is a dependency on `HTTPMessage` behavior that urllib3 does not control. Delete and re-add is correct only because of two semantics:

- `del message[name]` removes every field with that name.
- `message[name] = value` appends at the end and never overwrites.

Order survives only if all names are removed first and everything is re-added in the original sequence. The first loop deletes once per occurrence, and deleting an absent name is a no-op, so the repeats are harmless. The second loop re-adds each `(name, value)` pair from `header_items`. Interleaved duplicates, such as two `Set-Cookie` fields around another header, return to their original positions. If either semantic changed in a future Python, the rewrite would silently reorder or duplicate headers. The unit test that pins order and duplicates is what would catch it. [[diff:src-urllib3-connection.py:105-108]]

Two other choices limit the cost:

- **Guard.** The rewrite runs only when `headers_changed` is true, so responses without folds, which is nearly all traffic, never have their message touched. The risk is confined to the responses that need the fix. No test asserts the untouched path, so this rests on reading the code. [[diff:src-urllib3-connection.py:94-102]]
- **Single source.** The function returns `header_items`, the same list it wrote back, and `getresponse` builds `HTTPHeaderDict` from it. Both copies come from one list in one step. A second read of `msg` would add a way for them to diverge. [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]]

The rewrite is not atomic. Between the deletes and the re-adds the message is briefly missing its headers. From reading the code, this happens inside `getresponse` before the response is returned, which suggests no outside caller can observe the gap. I did not trace every holder of `msg`, so treat that as unverified.

::: principle
When one fact lives in several copies, make the invariant true in all of them, and produce the copies from one source so they cannot disagree. Change shared objects in place, because replacement only helps the holders you can reach. Enforce the rule at the earliest point you own, not at a point you would have to patch globally.
:::

### Follow-ups

- Does anything else read `_original_response.msg` or `.headers` besides Requests cookie extraction? | ask: Which consumers read `_original_response.msg` or `.headers`, and would any of them see different behavior from the delete-and-re-add rewrite?
- What would break if `_normalize_header_values` replaced the message instead of mutating it? | ask: If `_normalize_header_values` returned a new `HTTPMessage` and `getresponse` swapped it onto the response, which tests and which consumers would break?
- Is the order of duplicate headers really preserved when a fold sits in the middle? | ask: Walk through `_normalize_header_values` for a message with Set-Cookie, X-Second, Set-Cookie where only the first Set-Cookie is folded, and show the resulting order.

```json
{"depth": {"level": "deep", "cardId": "g-alt"}}
```