::: example
```
value = "a\r\nb"        # passes the "\r\n" fast-path guard, then fails the pattern

_OBSOLETE_FOLD_RE   = (?:(?<![ \t])[ \t]+)?\r\n[ \t]+
  sub(" ", value)   -> "a\r\nb"    (no blank after CRLF, no match, unchanged)

trailing group loosened to [ \t]*
  sub(" ", value)   -> "a b"       (two field lines merged into one value)

test_normalize_header_value cases: "ordinary\tvalue", "before \t\r\n\t  after",
  "one\r\n two\t\r\n\tthree", "one\r\n \r\n\tthree"
  -> every expected output is identical under + and *
```
Every parametrized input already contains a blank after its CRLF, so `+` and `*` give the same strings, and only an input like `"a\r\nb"` tells them apart. The general rule is that a rewrite rule is pinned from both sides only when the suite includes a case it must refuse. [[diff:src-urllib3-connection.py:80-82]] [[diff:src-urllib3-connection.py:86-88]] [[diff:test-test_connection.py:217-220]]
:::

::: example
```
message = HTTPMessage()
message["X-First"]    = "one"
message["Set-Cookie"] = "b=2"          # nothing folded

headers_changed stays False -> no del, no set, message untouched

guard removed -> del X-First; del Set-Cookie; X-First=one; Set-Cookie=b=2
  message.items() == [("X-First", "one"), ("Set-Cookie", "b=2")]   # still equal
```
The two runs produce equal output, so an `==` assertion cannot see the extra rewrite. Only a spy that records `__delitem__` and `__setitem__` calls, with zero expected here, can fail when the guard is removed. The one unit test that builds a message has a folded `Set-Cookie`, so it always takes the rewrite path. In general, a skipped-work property needs a test that observes the work. [[diff:src-urllib3-connection.py:95-108]] [[diff:test-test_connection.py:226-245]]
:::

::: example
```
wire:  Set-Cookie: a=1\r\n  two
       set-cookie: b=2

message.items()          -> [("Set-Cookie", "a=1\r\n  two"), ("set-cookie", "b=2")]
header_items (cleaned)   -> [("Set-Cookie", "a=1 two"),      ("set-cookie", "b=2")]

del message["Set-Cookie"]  # lookup is case-insensitive, removes both fields
del message["set-cookie"]  # no-op
re-add from header_items   -> each field is re-added with the casing it had in items()
```
This input is hypothetical, because the tests use one casing per name. It is the case where the rewrite's "delete every occurrence, then replay" behaviour could matter for casing. If casing is preserved, the result matches the input order and spelling. This sketch shows what to check, not an observed result. The rule is that case-insensitive removal needs a test with differently cased duplicates to show the replay restores them. [[diff:src-urllib3-connection.py:105-108]] [[diff:test-with_dummyserver-test_socketlevel.py:101-103]]
:::

```json
{"title": "What the tests cover and miss", "contribute": {"facts": []}}
```