## The problem

HTTP/1.1 servers may still send obsolete folded header lines (`obs-fold`), where a value continues on the next line after CRLF plus whitespace. Python's `http.client` keeps those raw CRLFs inside the `HTTPMessage` values. urllib3 then copied them unchanged into `HTTPHeaderDict`, so a header such as a folded `Set-Cookie` reached consumers with embedded `\r\n` in it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

Before the change, `getresponse` built the headers with `HTTPHeaderDict(httplib_response.msg.items())`, with no cleanup. The original `HTTPMessage` stayed on the response as `_original_response.msg`. Cookie consumers such as Requests read that message directly, and they could re-emit raw CRLF on later requests. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]

The reported case is #1362. Whitespace before the colon and header-name validation are a separate issue and are not part of this change. [[desc:d-p4]]

## The central idea

The change unfolds every `obs-fold` right after parsing, before anything reads the headers. `_OBSOLETE_FOLD_RE` matches optional whitespace, then CRLF, then required whitespace, and `_normalize_header_value` replaces each match with one space. [[diff:src-urllib3-connection.py:80-88]]

`_normalize_header_values` applies this to the `HTTPMessage` items. If any value changed, it deletes and re-adds the headers on the original message, so the message and urllib3's `HTTPHeaderDict` agree. It returns the cleaned items, and `getresponse` builds `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

## Decisions and questions

**Decisions**
- **Normalize in `getresponse`, and mutate the original message.** The alternative is to clean only the `HTTPHeaderDict` copy. That would leave the CRLF in `msg`, which Requests reads for cookies. The description gives this as the reason. The cost is that urllib3 now rewrites an `http.client` object it does not own. [[desc:d-p2]] [[diff:src-urllib3-connection.py:102-108]]
- **Rewrite by delete and re-add.** `HTTPMessage` has no in-place item replacement. Delete-and-re-add keeps the object's identity, and the order is preserved because every name is removed and then re-added in the original sequence. The reason is inferred. [[diff:src-urllib3-connection.py:105-108]]
- **Fast path and regex shape.** The code skips values without `\r\n`. A lookbehind keeps matching of the leading whitespace linear in long runs; the comment says it avoids quadratic backtracking. [[diff:src-urllib3-connection.py:80-88]]
- **Collapse to a single space.** The change follows RFC 9112, and each fold becomes one space. Adjacent folds collapse to one space too, with no zero-space case. [[diff:test-test_connection.py:218-220]]

**Invariants**
- After `getresponse`, no header value in `HTTPHeaderDict` or in `msg` contains a fold CRLF. Only the socket test checks that the message and the dict agree. [[diff:test-with_dummyserver-test_socketlevel.py:135-146]]
- Header names, order, duplicates, payload, policy and defects are preserved. The unit test checks this. [[diff:test-test_connection.py:226-249]]

**Known uncertainties**
- Values containing a bare `\r\n` that is not followed by whitespace are left unchanged. Nothing tests that case. Reading the code is enough to confirm it.
- `del message[name]` removes all headers with that name. The loop does this once per occurrence, which is harmless because deleting an absent name is a no-op. Re-adding follows `header_items` order, so duplicates stay in order. [[diff:src-urllib3-connection.py:105-108]]
- Header names are re-set from the `message.items()` output. A name containing a CRLF would not be affected, but no test exercises this.

**Interfaces with reach**
- The new helpers are private to `connection.py`, so the public surface is unchanged.
- The visible effect is on `HTTPResponse.headers` and on `_original_response.msg`, which Requests and others read. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

```json
{"pendingCards":[{"id":"g-alt","label":"Mutating msg vs. only the dict","why":"Lets you judge whether rewriting the http.client message is the right place for the fix."},{"id":"g-regex","label":"The _OBSOLETE_FOLD_RE lookbehind","why":"Lets you judge the linear-time claim and the whitespace cases it handles."},{"id":"g-tests","label":"What the tests cover and miss","why":"Lets you see which edge cases (bare CRLF, header-name edge cases) are untested."},{"id":"g-reach","label":"Who reads _original_response.msg","why":"Shows which consumers depend on the message staying in sync with HTTPHeaderDict."}],"plotlines":[{"id":"obs-fold-unfolding","name":"Unfold obsolete folded response headers","description":"Replaces obs-fold in response headers with a single space, in both HTTPHeaderDict and the original HTTPMessage, so downstream consumers never see raw CRLF.","hunks":["h:src-urllib3-connection.py:fa60105d7fcbe8fe","h:src-urllib3-connection.py:b355d2096d4d7f39","h:test-test_connection.py:6cfb09ec98cba6ba","h:test-test_connection.py:92cf4ca541bdb0f2","h:test-test_connection.py:b33779988cee5f8a","h:test-with_dummyserver-test_socketlevel.py:29382503b8689e5f","h:test-with_dummyserver-test_socketlevel.py:949dda852e448b55","h:changelog-1362.bugfix.rst:d1c6f159e5ffb42d"]}],"glossary":[{"name":"obs-fold","definition":"Obsolete HTTP header line folding: CRLF followed by SP/HTAB inside a field value.","citation":"diff:src-urllib3-connection.py:80-82"},{"name":"_normalize_header_value","definition":"Replaces each obs-fold in one value with a single space; skips values without CRLF.","citation":"diff:src-urllib3-connection.py:85-88"},{"name":"_normalize_header_values","definition":"Unfolds all values of an HTTPMessage, syncs the message, returns the items.","citation":"diff:src-urllib3-connection.py:91-110"},{"name":"HTTPHeaderDict","definition":"urllib3's response header mapping, built in getresponse.","citation":"diff:src-urllib3-connection.py:650-651"}],"contribute":{"facts":[],"open_questions":["A bare \\r\\n not followed by SP/HTAB is left in the value; is that intended and tested?","Does mutating http.client's HTTPMessage affect other consumers beyond cookie handling?"]}}
```