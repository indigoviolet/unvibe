## Mutating msg vs. only the dict

The fix has to clean two copies of the headers. Before this change, `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()`. Python's own header object, the `HTTPMessage`, also stayed on the response as `_original_response.msg`. The description says cookie libraries such as Requests read that object, not urllib3's dict. If only `HTTPHeaderDict` were cleaned, `msg` would still hold the raw `\r\n`, and Requests could send it again. So `_normalize_header_values` also writes the cleaned values back into `msg`. The socket test checks both copies. It checks the dict's `set-cookie` list. Then it checks the same list through `_original_response.msg.get_all("set-cookie")`. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p2]] [[diff:src-urllib3-connection.py:102-108]] [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]

The write-back deletes every header and adds each one back. It does this on the same `HTTPMessage` object. The other way would be to build a new `HTTPMessage` and put it on the response. That would be a different object. The socket test checks that `_original_response.headers is _original_response.msg`. The unit test checks that `defects` and `policy` are the same objects before and after. Any code that already holds the old message would keep seeing the folded values after a swap. The code comment says the goal is "preserving its identity and header ordering". I am inferring that the author chose delete and re-add for this reason. [[diff:test-with_dummyserver-test_socketlevel.py:141]] [[diff:test-test_connection.py:248-249]] [[diff:src-urllib3-connection.py:103-104]]

A third way is to fix the parsing itself. You could patch `http.client.parse_headers` or subclass the response class. Then values would be unfolded before any copy exists. But patching a function in the standard library affects every user of `http.client` in the process. This change does not try it. No reason for rejecting it is stated, so that is my inference too. Cleaning the headers inside `getresponse` keeps the change inside urllib3's own connection class.

There are costs. urllib3 now changes an object it does not own. It also relies on how `HTTPMessage` behaves. `del message[name]` removes every header with that name. `message[name] = value` adds a header at the end. The loop deletes all headers first. Then it adds them back in `header_items` order. That is why duplicate names keep their order. [[diff:src-urllib3-connection.py:105-108]]

The rewrite runs only when `headers_changed` is true. A response with no folds never touches the message. [[diff:src-urllib3-connection.py:94-102]]

The function also returns the cleaned items. So `HTTPHeaderDict` is built from the same data that was written back. It is not built from a second read of `msg`. [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]]

- Does anything else read `_original_response.msg` or `.headers` besides Requests cookie extraction?
- What would break if `_normalize_header_values` replaced the message instead of mutating it?
- Is the order of duplicate headers really preserved when a fold sits in the middle?

```json
{"depth": {"level": "simple", "cardId": "g-alt"}}
```