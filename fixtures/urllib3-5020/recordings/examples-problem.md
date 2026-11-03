::: example
```
wire:       Set-Cookie: ___utmvbtouVBFmB=gZg\r\n
                ········XbNOjalT: Lte; path=/; Max-Age=900\r\n
held value: "___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900"
required:   "___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900"
```
This is the folded `Set-Cookie` the socket test sends. The continuation line starts with spaces, so the parser keeps `\r\n` plus the indent inside one value. The test expects the single-line form. If a consumer writes the held value back out, the `\r\n` becomes a line break. The general rule is that a parser can be faithful to the bytes and still hand on a value that breaks the single-line invariant. [[diff:test-with_dummyserver-test_socketlevel.py:101-102]] [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]
:::

::: example
```
# hypothetical: only the dict is cleaned
r.headers.getlist("set-cookie")
  -> ["___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900", ...]   # clean
r._original_response.msg.get_all("set-cookie")
  -> ["___utmvbtouVBFmB=gZg\r\n    XbNOjalT: ...", ...]                  # still folded
```
This shows why one clean copy is not enough. The two lookups read different copies of the same header and give different answers. The socket test asserts both lookups against the same unfolded list, so a one-copy fix fails it. The general rule is that the invariant must hold for every route a consumer can take to the data, not just the route the fixer had in mind. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]] [[diff:src-urllib3-connection.py:650-651]]
:::

```json
{"title": "The problem", "contribute": {"facts": []}}
```