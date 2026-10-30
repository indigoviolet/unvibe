# Q9 (follow-up, explored) — source B

Moving the cache assignment looks like a fix — I'll map every `_ech_config` access to verify.
Found seven `_ech_config` touchpoints — I'll read the remaining paths to complete the analysis.
No.

`Lib/ssl.py:1478-1481` is the only cached write that validates:

```python
def set_ech_config(self, ech_config):
    self._ech_config = ech_config
    if self._sslobj is not None:
        self._sslobj.set_ech_config(ech_config)
```

Moving the store after the `if self._sslobj is not None:` call would preserve the old value when `Modules/_ssl.c:2242-2256` raises `ValueError`/`SSLError` for server-side, post-handshake, or bad `ECHConfigList`, for a connected socket.

It would not cover the unconnected paths, which cache without validation:

* `Lib/ssl.py:1083` in `SSLSocket._create`: `self._ech_config = ech_config` unconditionally.
* `Lib/ssl.py:1142-1143` deferred apply on connected `_create`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`.
* `Lib/ssl.py:1520-1521` in `_real_connect`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`.

When `self._sslobj is None`, `SSLSocket.set_ech_config` never calls the C validator, so reorder changes nothing: an invalid value is still cached and only fails later at `1142-1143`/`1520-1521`.

`Lib/ssl.py:1022-1028` (`SSLObject.set_ech_config`) and `Lib/ssl.py:853` (`SSLObject._create`) call `self._sslobj.set_ech_config` directly with no `_ech_config`, so unaffected.
