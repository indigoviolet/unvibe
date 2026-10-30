# Q9 (follow-up, explored) — source D

No.

`SSLSocket.set_ech_config` at `Lib/ssl.py:1479-1481` does:

```python
self._ech_config = ech_config
if self._sslobj is not None:
    self._sslobj.set_ech_config(ech_config)
```

Moving the store to after the call would preserve the old value when `self._sslobj is not None` at `Lib/ssl.py:1480` and the C validation fails.

It would not cover the `None` branch: when `self._sslobj is None`, there is no validation, so the moved assignment still caches unvalidated bytes.

That cached value is later trusted by two readers:

* `Lib/ssl.py:1142-1143` in `SSLSocket._create`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`
* `Lib/ssl.py:1520-1521` in `SSLSocket._real_connect`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`

There is also a separate writer that moving the setter does not touch: `Lib/ssl.py:1083` in `SSLSocket._create` does `self._ech_config = ech_config` before any `SSL` object exists. `Lib/ssl.py:396-400` only rejects `ech_config` for server-side use or without `HAS_ECH`, not invalid ECHConfigList bytes, so constructor-supplied bad bytes are already cached before content validation.
