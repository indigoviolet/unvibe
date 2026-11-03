`getresponse` now passes the parsed message through `_normalize_header_values` before building `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:650-651]]

::: simple
`getresponse` now cleans up the response headers before it builds `HTTPHeaderDict`. It does this with a new helper, `_normalize_header_values`.
:::

- `_normalize_header_value` replaces each `OWS CRLF RWS` run with one space, using the `_OBSOLETE_FOLD_RE` regex. It returns early when the value has no `\r\n`. [[diff:src-urllib3-connection.py:80-88]]

::: example
```python
_normalize_header_value("before \t\r\n\t  after")  # -> "before after"
_normalize_header_value("ordinary\tvalue")         # -> "ordinary\tvalue" (no CRLF, returned as is)
```

In the first call, the trailing SP and HTAB, the CRLF and the leading HTAB and two spaces are one match, replaced by a single space. The second value has no `\r\n`, so the fast path returns it without running the regex. [[diff:test-test_connection.py:217-218]] [[diff:src-urllib3-connection.py:86-88]]
:::

- `_normalize_header_values` returns the normalized `(name, value)` list. If any value changed, it also deletes every header from the original `HTTPMessage` and re-adds the normalized ones in order. This keeps the message and the `HTTPHeaderDict` identical. [[diff:src-urllib3-connection.py:91-110]]

::: example
```python
# message.items() before
[("X-First", "one"), ("Set-Cookie", "a=1 \r\n two"),
 ("X-Second", "three"), ("Set-Cookie", "b=2")]

# returned list, and message.items() after
[("X-First", "one"), ("Set-Cookie", "a=1 two"),
 ("X-Second", "three"), ("Set-Cookie", "b=2")]
```

Only the first `Set-Cookie` value changes. Because a change was found, all four headers are deleted and re-added. Order and the duplicate `Set-Cookie` entries stay as they were, and `message.get_all("Set-Cookie")` returns `["a=1 two", "b=2"]`. [[diff:test-test_connection.py:226-246]] [[diff:src-urllib3-connection.py:102-108]]
:::

```json
{"title": "The central idea", "contribute": {"facts": []}}
```