## How it's built up

There is one plotline. It has three pieces:
::: simple
The change has one plotline, and it has three pieces:
:::
::: deep
There is one plotline. The three pieces follow the path one header takes. A pure function handles one string. A function handles the whole message. The call site connects both to `getresponse`. Each piece depends only on the one before it, so each can be tested, and reasoned about, without the pieces after it.
:::

1. The regex and the single-value helper `_normalize_header_value`. They return early when a value has no CRLF. [[diff:src-urllib3-connection.py:80-88]]
2. The message-level helper `_normalize_header_values`. It rewrites the message only if something changed, and it returns the items. [[diff:src-urllib3-connection.py:91-110]]
3. The call in `getresponse`, which feeds the cleaned items to `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:647-651]]

::: deep
**Layer 1 holds the rule.** A fold is optional whitespace, then CRLF, then required whitespace, and it becomes one space. `_normalize_header_value` is a pure `str -> str` function that knows nothing about `HTTPMessage`, so the rule can be tested on bare strings. The early return is sound because the pattern needs a literal `\r\n` to match. A value without one cannot change, so skipping the regex gives the same result and saves the scan on nearly all headers. The lookbehind is also decided here. It fixes what one fold means: whitespace left by an earlier fold is not absorbed by the next, so adjacent folds yield one space each. It also bounds the cost on a long whitespace run. [[diff:src-urllib3-connection.py:80-88]]

**Layer 2 holds the synchronization.** A rule on strings does not make the message clean. The message has to be changed too, and the change must keep the object, its order and its duplicates. This layer is the only one that touches `HTTPMessage`. It returns the same list it wrote back, so layer 3 builds from the data that was just written, not from a second read that could drift. The `headers_changed` guard keeps responses without folds from ever being mutated. [[diff:src-urllib3-connection.py:91-110]]

**Layer 3 holds the integration.** The call site is two lines: normalize the message, then build `HTTPHeaderDict` from the result. It is the only place where the order matters. The message must be cleaned before the dict is built, or the dict would be a snapshot of folded data. [[diff:src-urllib3-connection.py:647-651]]
:::

The tests follow the same layers. Unit tests cover the single value and the message: order, duplicates, payload, policy and defects. A socket-level test covers the whole path, and a changelog fragment is added. [[diff:test-test_connection.py:214-249]] [[diff:test-with_dummyserver-test_socketlevel.py:92-146]] [[diff:changelog-1362.bugfix.rst:1-3]]
::: simple
The tests follow the same three layers. Unit tests check one value and then a whole message. For the message they check order, duplicate headers, the body text (payload), policy and defects. A socket-level test runs the whole path with a real network connection. The change also adds a changelog note.
:::
::: deep
Each test layer pins the guarantee of the code layer it matches. The `_normalize_header_value` cases pin the rule on bare strings: mixed SP/HTAB runs, multiple folds, and an adjacent fold that gives two spaces. [[diff:test-test_connection.py:214-224]]

The message test pins the synchronization contract. Header order, duplicate `Set-Cookie` entries, payload, and the identity of `defects` and `policy` must all survive the delete-and-re-add. Identity of `defects` and `policy` is what shows the same object was rewritten, not replaced. [[diff:test-test_connection.py:226-249]]

The socket test pins the integration. It checks that real parsed bytes end up clean in both `HTTPHeaderDict` and `_original_response.msg`, and that the two agree. Neither unit layer can show this, because each builds its own input. The socket test is also the only one that runs the parser's real output through the call site. [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

The changelog fragment records the user-visible effect: no raw CRLF in values such as `Set-Cookie`. [[diff:changelog-1362.bugfix.rst:1-3]]

Two guarantees have no test in any layer: the linear-time claim for long whitespace runs, and the unchanged-message path when no value is folded.
:::

::: principle
Split a fix by the data it touches. Put the rule on the smallest value that can carry it. Put the synchronization on the container that holds those values. Put the integration where the container is created. Then each guarantee has one owner and one test, and a regression shows up in the layer that owns it.
:::

```json
{"depth": {"level": "deep", "cardId": "buildup"}}
```