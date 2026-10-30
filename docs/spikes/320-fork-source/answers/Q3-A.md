# Q3 (edge, explored) — source A

In `Lib/ssl.py:1479-1481`:

```python
def set_ech_config(self, ech_config):
    self._ech_config = ech_config
    if self._sslobj is not None:
        self._sslobj.set_ech_config(ech_config)
```

Cache assignment at `Lib/ssl.py:1479` happens before validation.

On connected socket `Lib/ssl.py:1480` is true, so calls `_ssl._SSLSocket.set_ech_config`.

That C impl parses first in `Modules/_ssl.c:2253-2255`:

```c
OSSL_ECHSTORE *store = ech_store_from_config(state, ech_config);
if (store == NULL) {
    return NULL;
```

Invalid bytes fail there, before `Modules/_ssl.c:2257` `SSL_set1_echstore(self->ssl, store)`, so `SSL` object keeps old config but Python `self._ech_config` now holds invalid bytes.

On next reconnect `Lib/ssl.py:1520-1521` in `_real_connect` reuses it:

```python
if self._ech_config is not None:
    self._sslobj.set_ech_config(self._ech_config)
```

Same re-apply in `_create` at `Lib/ssl.py:1142-1143`. Failed value is retried and connect fails again.
