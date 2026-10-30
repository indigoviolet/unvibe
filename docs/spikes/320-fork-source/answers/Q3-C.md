# Q3 (edge, explored) — source C

In `Lib/ssl.py:1478-1481`:

```python
def set_ech_config(self, ech_config):
    self._ech_config = ech_config
    if self._sslobj is not None:
        self._sslobj.set_ech_config(ech_config)
```

On an already-connected socket `self._sslobj is not None` (`Lib/ssl.py:1480`), so the C call is attempted.

In `Modules/_ssl.c:2242-2256` the C implementation validates before applying:

```c
if (self->socket_type != PY_SSL_CLIENT) { ... return NULL; }
if (!SSL_in_before(self->ssl)) { ... return NULL; }
OSSL_ECHSTORE *store = ech_store_from_config(state, ech_config);
if (store == NULL) { return NULL; }
```

Invalid bytes fail in `ech_store_from_config` (`Modules/_ssl.c:5318-5329`) and return `NULL` without reaching `SSL_set1_echstore(self->ssl,store)` (`Modules/_ssl.c:2257-2258`), so the underlying `SSL` keeps its old store while the exception propagates.

Left behind: `self._ech_config` is already the invalid value (`Lib/ssl.py:1479`).

On next reconnect it is re-applied:

* `Lib/ssl.py:1142-1143`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)` in `_create`.
* `Lib/ssl.py:1520-1521`: same pattern in `_real_connect`.
