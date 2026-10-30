# Q9 (follow-up, explored) — source A

No.

`SSLSocket.set_ech_config` at `Lib/ssl.py:1479-1481` is:

```python
self._ech_config = ech_config
if self._sslobj is not None:
    self._sslobj.set_ech_config(ech_config)
```

Reordering fixes only the connected case, where `Modules/_ssl.c:2242-2256` rejects server-side use, post-handshake use, and bad content via `ech_store_from_config`.

It does not fix the disconnected case: when `self._sslobj is None` no validation occurs, so the value is cached regardless of order. That cached value is later trusted by both re-apply sites:

* `Lib/ssl.py:1142-1143` in `SSLSocket._create`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`
* `Lib/ssl.py:1520-1521` in `SSLSocket._real_connect`: same pattern.

The initial write has the same gap: `Lib/ssl.py:1083` in `SSLSocket._create` does `self._ech_config = ech_config` before the validating re-apply at `1142-1143`.
