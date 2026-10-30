# Q9 (follow-up, explored) — source C

No.

`SSLSocket.set_ech_config` in `Lib/ssl.py:1479-1481` is:

```python
self._ech_config = ech_config
if self._sslobj is not None:
    self._sslobj.set_ech_config(ech_config)
```

Moving the store after the call only fixes the `self._sslobj is not None` branch, where `Modules/_ssl.c:2242-2256` validates role, `SSL_in_before`, and parsing via `ech_store_from_config`.

It does not validate the unconnected path:

* `Lib/ssl.py:1083` in `SSLSocket._create`: `self._ech_config = ech_config` stores the constructor argument without parsing it.
* `Lib/ssl.py:1479` path when `self._sslobj is None`: stores with no `self._sslobj.set_ech_config` call to move after.
* Both deferred uses only fail later: `Lib/ssl.py:1142-1143` in `_create` and `Lib/ssl.py:1520-1521` in `_real_connect`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`.

So an invalid `ech_config` set on a not-yet-connected socket would still be cached and still fail at connect time. The `SSLObject._create` path at `Lib/ssl.py:852-853` has no cache and is unaffected.
