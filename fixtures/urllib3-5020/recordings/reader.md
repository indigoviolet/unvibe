## The problem

Python's `http.client` leaves obsolete folded response header lines (`obs-fold`) inside the `HTTPMessage` values. A header sent as `Set-Cookie: a=b\r\n    c=d` therefore reaches urllib3, and anything downstream, with a raw `\r\n` in the value. RFC 9112 says a receiver must replace each such fold with spaces before interpreting the value. [[desc:d-p1]]

Before this change, `getresponse` built `HTTPHeaderDict` straight from `httplib_response.msg.items()`, so the raw CRLF went into both the `HTTPHeaderDict` and the original message. [[diff:src-urllib3-connection.py:647-651]] Consumers such as Requests read cookies from the original message, so they could re-emit the raw CRLF when they serialised the next request. [[desc:d-p2]]

This is the folded `Set-Cookie` case from #1362. The whitespace-before-colon and header-name validation scope is not part of this problem. [[desc:d-p4]]

## The central idea

`getresponse` now passes the parsed message through `_normalize_header_values` before building `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:650-651]]

- `_normalize_header_value` replaces each `OWS CRLF RWS` run with one space, using the `_OBSOLETE_FOLD_RE` regex. It returns early when the value has no `\r\n`. [[diff:src-urllib3-connection.py:80-88]]
- `_normalize_header_values` returns the normalized `(name, value)` list. If any value changed, it also deletes every header from the original `HTTPMessage` and re-adds the normalized ones in order. This keeps the message and the `HTTPHeaderDict` identical. [[diff:src-urllib3-connection.py:91-110]]

## How it's built up

The change is a single plotline, `obs-fold-unfolding`, and it builds up in three pieces.

1. The regex and `_normalize_header_value` define what unfolding means for one value. [[diff:src-urllib3-connection.py:80-88]]
2. `_normalize_header_values` applies that to a whole message and writes the result back to the message. [[diff:src-urllib3-connection.py:91-110]]
3. `getresponse` calls it, so `HTTPHeaderDict` is built from the normalized items. [[diff:src-urllib3-connection.py:650-651]]

Two sets of tests cover it:
- The unit tests cover single values, including adjacent folds, and check that the message keeps its order, duplicates, payload, policy and defects. [[diff:test-test_connection.py:214-249]]
- The socket-level test sends folded and duplicate cookies, every SP/HTAB combination around the CRLF, and repeated folds. It asserts on both `r.headers` and the original message. [[diff:test-with_dummyserver-test_socketlevel.py:92-146]]

A changelog fragment records the fix. [[diff:changelog-1362.bugfix.rst:1-3]]

## Decisions and questions

**Decisions**
- **Mutate the original `HTTPMessage` in place.** The alternative is to normalize only urllib3's `HTTPHeaderDict`. The stated reason is that cookie consumers such as Requests read the original message. [[desc:d-p2]] The cost is that urllib3 now rewrites a stdlib object it does not own. It keeps the object's identity, so existing references stay valid. [[diff:src-urllib3-connection.py:102-108]]
- **Rewrite by delete-and-re-add.** `del message[name]` removes every entry of that name, and the second loop re-adds all entries in the original order. This preserves order and duplicates without touching private `HTTPMessage` internals. The author's reason is inferred. [[diff:src-urllib3-connection.py:105-108]]
- **One space per fold.** The regex consumes the surrounding whitespace together with the CRLF, so adjacent folds give `"one  three"` and not one merged space. [[diff:test-test_connection.py:218-220]] The `(?<![ \t])` lookbehind starts the optional leading-whitespace match only at the start of a whitespace run. This is to avoid quadratic backtracking. [[diff:src-urllib3-connection.py:80-82]]
- **Fast path.** Values without `\r\n` skip the regex, and the message is only rewritten if something changed. [[diff:src-urllib3-connection.py:86-87]]

**Invariants**
- After `getresponse`, `HTTPHeaderDict` and `httplib_response.msg` hold the same values. The socket test asserts this for `Set-Cookie`. [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]
- Header names, order and duplicates are preserved. The unit test checks this. [[diff:test-test_connection.py:226-249]]

**Known uncertainties**
- The code and tests do not show whether header-name case is preserved through `del` and re-add. `message[name]` stores the name as given, so the case is probably kept. Running a mixed-case header through the unit test would settle it.
- The delete-and-re-add path does not run again for a value that was already normalized, but no test shows this.

**Interfaces with reach**
- No public API changes. The visible effect is that `response.headers` and `response._original_response.msg` no longer contain CRLF. Requests cookie extraction is the downstream consumer. [[desc:d-p2]]

```json
{"pendingCards":[{"id":"g-inplace","label":"Mutating HTTPMessage in place","why":"Lets you judge whether rewriting the stdlib message was needed, compared with normalizing only HTTPHeaderDict."},{"id":"g-regex","label":"The _OBSOLETE_FOLD_RE lookbehind","why":"Lets you judge the linear-time claim and the one-space-per-fold behaviour."},{"id":"g-tests","label":"How the tests cover edge cases","why":"Lets you see which whitespace and header-name cases are covered and which are not."},{"id":"g-downstream","label":"Effects on Requests and other consumers","why":"Lets you see who reads the original message and what would break if it kept the CRLF."}],
"plotlines":[{"id":"obs-fold-unfolding","name":"obs-fold-unfolding","description":"Unfolds obs-fold response header values and keeps HTTPMessage and HTTPHeaderDict in sync, with tests and a changelog entry.","hunks":["h:src-urllib3-connection.py:fa60105d7fcbe8fe","h:src-urllib3-connection.py:b355d2096d4d7f39","h:test-test_connection.py:6cfb09ec98cba6ba","h:test-test_connection.py:92cf4ca541bdb0f2","h:test-test_connection.py:b33779988cee5f8a","h:test-with_dummyserver-test_socketlevel.py:29382503b8689e5f","h:test-with_dummyserver-test_socketlevel.py:949dda852e448b55","h:changelog-1362.bugfix.rst:d1c6f159e5ffb42d"]}],
"glossary":[{"name":"obs-fold","definition":"Obsolete HTTP header line folding (OWS CRLF RWS) that RFC 9112 requires receivers to replace with spaces.","citation":"diff:src-urllib3-connection.py:80-82"},{"name":"_normalize_header_values","definition":"Unfolds every header in an HTTPMessage, syncs the message, and returns the (name, value) items.","citation":"diff:src-urllib3-connection.py:91-110"},{"name":"HTTPHeaderDict","definition":"urllib3's response header mapping, now built from normalized items.","citation":"diff:src-urllib3-connection.py:650-651"}],
"contribute":{"facts":[],"open_questions":["Is header-name case preserved when _normalize_header_values deletes and re-adds headers on the HTTPMessage?"]}}
```