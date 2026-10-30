# Q3 (edge, explored) — source D

`SSLSocket.set_ech_config` assigns before validating:

* `Lib/ssl.py:1479`: `self._ech_config = ech_config`
* `Lib/ssl.py:1480-1481`: `if self._sslobj is not None: self._sslobj.set_ech_config(ech_config)`

On an already-connected socket `self._sslobj is not None`, so it enters the C implementation after the cache is mutated.

The C implementation fails after that point without updating `self->ssl`:

* `Modules/_ssl.c:2247-2250`: `if (!SSL_in_before(self->ssl))` -> `ValueError: Cannot set ECH configuration after handshake.`
* `Modules/_ssl.c:2253-2255`: `store = ech_store_from_config(...); if (store == NULL) return NULL;` -> `SSLError` for invalid bytes.
* `Modules/_ssl.c:2257-2262`: `SSL_set1_echstore()` only reached on success.

Left behind: `self._ech_config` is the invalid bytes, while the underlying `SSL` retains the prior configuration — wrapper/connection diverged.

On next reconnect the stale value is reapplied:

* `Lib/ssl.py:1520-1521`: `_real_connect`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`
* `Lib/ssl.py:1142-1143`: `_create`: same re-apply pattern.
