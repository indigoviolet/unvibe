The core invariant is that one response has one sequence of header fields, however many objects hold it. Here two objects hold it. The `HTTPMessage` is the parsed source that `http.client` produced. The `HTTPHeaderDict` is a derived copy, built once in `getresponse` and read through `r.headers`. [[diff:src-urllib3-connection.py:650-651]] A derived copy is only correct while it equals what it was derived from. Once the code decides that the true value of a field is the unfolded one, every holder of the field has to agree. Otherwise the answer depends on who asks.

This matters in practice because the two objects have different readers. urllib3 and its users read `HTTPHeaderDict`. According to the description, outside consumers such as Requests read `Set-Cookie` from the original message. [[desc:d-p2]] If only the dict were normalized, the message would still hold `"a=1 \r\n two"`, and that CRLF could be re-emitted when the next request is serialized. That Requests reads `_original_response.msg` comes from the description. I could not check it in Requests from here.

The code keeps the two views equal by construction, not by checking them afterwards. Inside `_normalize_header_values`:

- It builds one normalized `(name, value)` list from `message.items()`. That list is returned, and `getresponse` feeds it to `HTTPHeaderDict`.
- If any value changed, it deletes every header name from the message and re-adds each item from the same list, in order. [[diff:src-urllib3-connection.py:94-110]]

Both views are therefore functions of one list. They cannot drift at this point, because no second computation could disagree.

Three properties explain why the rewrite looks the way it does:

- **Identity.** The message must be mutated, not replaced. `_original_response.headers is _original_response.msg`, and `http.client` and any outside holder keep references to that object. [[diff:test-with_dummyserver-test_socketlevel.py:141]] A fresh message in `getresponse` would leave the old references pointing at the folded copy.
- **Order and duplicates.** For `Set-Cookie`, the sequence is part of the value. Cookies cannot be safely comma-joined, and a jar reads them in order, so a reordered or collapsed set could change which cookie wins. Deleting by name removes all duplicates, and re-adding in sequence restores them. The unit test pins this. [[diff:test-test_connection.py:226-249]] The choice of delete-and-re-add is inferred: `HTTPMessage` has no public way to replace one occurrence of a repeated header.
- **Skip when unchanged.** When `headers_changed` is false, both views still come from the same untouched source, so they trivially agree. The rebuild, and its risk, is paid only for folded responses. [[diff:src-urllib3-connection.py:102]]

The alternative is to normalize only the copy that goes into `HTTPHeaderDict`. It is simpler and leaves the `http.client` object alone, but it breaks the invariant above. The cost of the chosen design is that urllib3 now mutates an object owned by `http.client`, and the rebuild goes through `__setitem__`, so it relies on the message's policy accepting every name and value it re-adds.

The agreement is also a one-time snapshot. It holds at the end of `getresponse`. Nothing keeps the two objects synchronized if later code mutates either one.

The tests enforce the invariant only partly. The socket test checks every header in the dict, including that no value contains `\r` or `\n`. For the original message it checks only `set-cookie`, `fold-mixed-repeated`, and `headers is msg`. [[diff:test-with_dummyserver-test_socketlevel.py:124-146]] So "identical" is guaranteed by the shared-list construction, and the tests sample it.

::: principle
When data exists in two representations, make one derive from the other, or make both derive from a single computed value, so that agreement is structural and doesn't have to be re-checked. Mutate shared objects in place when other parties hold references to them. Treat any order that readers depend on as part of the value.
:::

- Which code besides Requests reads the original message?
- Could the two views still diverge?

```json
{"depth": {"level": "deep", "cardId": "ann_7b3a3b68520f"}}
```