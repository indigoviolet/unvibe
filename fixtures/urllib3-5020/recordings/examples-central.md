::: example
```
value:   "before \t\r\n\t  after"
match:   " \t" + "\r\n" + "\t  "   (one match, starts at the first blank)
result:  "before" + " " + "after"  ->  "before after"

if the leading " \t" were not in the match:
result:  "before \t after"
```

This is the mixed SP/HTAB case from the unit test. The OWS before the CRLF and the RWS after it are one fold, so a single `sub` replaces all of it with one space. The lookbehind only lets the optional group start at the first blank of a run, so the match begins at the space after `before`. The socket test's `Fold-Mixed-Repeated` header applies the same rule to several folds in one value. In general, when a spec defines a construct as one span, write the pattern to match that whole span. Then the substitution yields the canonical form, not just a value with no CRLF. [[diff:test-test_connection.py:218]] [[diff:src-urllib3-connection.py:80-82]] [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]
:::

::: example
```
before (message.items()):
  X-First:    "one"
  Set-Cookie: "a=1 \r\n two"     <- folded
  X-Second:   "three"
  Set-Cookie: "b=2"

header_items after normalizing:
  [X-First one, Set-Cookie "a=1 two", X-Second three, Set-Cookie b=2]

write-back on the same object:
  del X-First        (1 field removed)
  del Set-Cookie     (removes BOTH Set-Cookie fields)
  del X-Second
  del Set-Cookie     (no-op, already gone)
  X-First=one; Set-Cookie=a=1 two; X-Second=three; Set-Cookie=b=2
```

This is the message from the unit test, with the first `Set-Cookie` folded. Because `del` drops every occurrence of a name, the interleaved order only survives if all names are deleted first and then re-added from `header_items` in sequence. The test then asserts `message.items() == expected` and `message.get_all("Set-Cookie") == ["a=1 two", "b=2"]`. It also asserts that `defects` and `policy` are the same objects, which a replacement `HTTPMessage` would not give. In general, when an API only offers remove-by-key and append, order-preserving in-place edits are done by clearing every affected key and replaying one saved list. [[diff:test-test_connection.py:226-249]] [[diff:src-urllib3-connection.py:102-110]]
:::

```json
{"title": "The central idea", "contribute": {"facts": []}}
```