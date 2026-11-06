## Decisions and questions

**Decisions**

::: simple
**Decisions**
:::

::: deep
**Decisions**
:::

- **Normalize in `getresponse`, and mutate the original message.** After parsing, the same header data lives in two places: the `HTTPHeaderDict` urllib3 builds, and the `HTTPMessage` that stays reachable as `_original_response.msg`. The dict is a snapshot taken from `msg.items()`, so nothing keeps the two in step. A fix that cleaned only the `HTTPHeaderDict` copy would leave the CRLF in `msg`, which Requests reads for cookies. The description gives this as the reason. The invariant "no fold in a value" has to hold in every copy a consumer can reach. The cost is that urllib3 now rewrites an `http.client` object it does not own, so the contents of `msg` become part of urllib3's observable behavior. [[desc:d-p2]] [[diff:src-urllib3-connection.py:102-108]]
- **Rewrite by delete and re-add.** `HTTPMessage` has no operation that replaces an item at its position. `del message[name]` removes every occurrence of a name, and `message[name] = value` appends at the end. Order and interleaved duplicates can therefore only be kept by deleting all the names first and then re-adding every item in its original sequence. Building a new `HTTPMessage` and swapping it in would break every holder of the old object, along with its `defects` and `policy`. Rewriting the same object in place reaches all holders. The author's reason for this choice is inferred, not stated. [[diff:src-urllib3-connection.py:105-108]]
- **Fast path and regex shape.** The code skips values without `\r\n`. This is sound because the pattern needs a literal `\r\n` to match, so a value without one cannot change. The leading whitespace is part of the match, so the whole fold collapses to one space. The lookbehind lets that optional group start only at the beginning of a whitespace run. Without it, `re.sub` would retry the greedy `[ \t]+` from every offset inside a long run, which is quadratic. The code comment states this goal. [[diff:src-urllib3-connection.py:80-88]]
- **Collapse each fold to a single space.** The change follows RFC 9112: each fold (OWS, CRLF, RWS) becomes exactly one space, never zero, so words on either side of a fold cannot fuse. The rule applies per fold, not per run of folds. The lookbehind stops a fold from absorbing whitespace left by the previous match, so adjacent folds give one space each. `"one\r\n \r\n\tthree"` becomes `"one  three"`, with two spaces, and the unit test pins this. The earlier wording that adjacent folds "collapse to one space" is imprecise. [[diff:test-test_connection.py:218-220]]

**Invariants**

::: simple
**Invariants**
:::

::: deep
**Invariants**
:::

- After `getresponse`, no header value in `HTTPHeaderDict` or in `msg` contains a fold CRLF. This can hold for both copies only because `getresponse` builds the dict from the same list that was written back to the message. A second read of `msg` could drift from it. Only the socket test checks that the message and the dict agree, and it covers CRLF input only. [[diff:test-with_dummyserver-test_socketlevel.py:135-146]]
- Header names, order, duplicates, payload, policy and defects are preserved. These are the properties that rewriting in place is meant to protect. The unit test checks them, including that `defects` and `policy` are the same objects afterwards. [[diff:test-test_connection.py:226-249]]

**Known uncertainties**

::: simple
**Known uncertainties**
:::

::: deep
**Known uncertainties**
:::

- Values containing a bare `\r\n` that is not followed by whitespace are left unchanged, because the trailing `[ \t]+` is required. That follows from the pattern, so reading the code confirms it, but no test pins it. The same gap applies to a lone `\n` or `\r`. A bare-LF fold may also still reach the value unchanged, because both the fast path and the regex key on `\r\n`. This is unverified here. [[diff:src-urllib3-connection.py:86-88]]
- `del message[name]` removes all headers with that name. The loop does this once per occurrence, which is harmless because deleting an absent name is a no-op. Re-adding follows `header_items` order, so duplicates stay in order. [[diff:src-urllib3-connection.py:105-108]]
- Header names are re-set from the `message.items()` output. Case-insensitive deletion means one `del` removes every casing of a name. Whether each re-added header keeps its original casing is not tested. A name containing a CRLF would not be affected, but no test exercises this. [[diff:src-urllib3-connection.py:105-108]]

**Interfaces with reach**

::: simple
**Interfaces with reach**
:::

::: deep
**Interfaces with reach**
:::

- The new helpers are private to `connection.py`, so the public surface is unchanged. [[diff:src-urllib3-connection.py:85-110]]
- The visible effect is on `HTTPResponse.headers` and on `_original_response.msg`, which Requests and others read. The socket test asserts that `_original_response.headers is _original_response.msg`. Mutating in place fixes both names, and a replacement object would not unless the response were also repointed. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

::: principle
When the same data lives in several copies, the invariant has to be made true in all of them. Produce the copies from one source, so they cannot disagree. Change shared objects in place, not by replacement, because replacement only helps the holders you can reach.
:::

```json
{"depth": {"level": "deep", "cardId": "decisions"}}
```