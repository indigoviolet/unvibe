# Q3 (edge, explored) — source CD

`Lib/ssl.py:1479-1481`:

```python
def set_ech_config(self, ech_config):
    self._ech_config = ech_config
    if self._sslobj is not None:
        self._sslobj.set_ech_config(ech_config)
```

On an already-connected socket `self._sslobj is not None`, so it calls into `Modules/_ssl.c:2238-2279` after mutating the cache.

That C impl validates after the cache write: `socket_type!=PY_SSL_CLIENT` and `!SSL_in_before(self->ssl)` raise `ValueError` `Modules/_ssl.c:2242-2250`, and `ech_store_from_config()` failure returns `NULL` without calling `SSL_set1_echstore()` `Modules/_ssl.c:2253-2256`. Invalid bytes fail in `ech_store_from_config()` via `OSSL_ECHSTORE_read_echconfiglist` / `num_entries==0` `Modules/_ssl.c:5299-5338`.

Left behind: `self._ech_config` holds the invalid bytes that raised, while the underlying `self->ssl` retains the old store.

On next reconnect `Lib/ssl.py:1520-1521` in `_real_connect`:

```python
if self._ech_config is not None:
    self._sslobj.set_ech_config(self._ech_config)
```

re-applies that known-bad value, so the failure repeats. Same re-apply exists in `_create` `Lib/ssl.py:1139-1143`.
