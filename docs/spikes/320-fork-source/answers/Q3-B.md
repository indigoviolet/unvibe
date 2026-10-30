# Q3 (edge, explored) — source B

`Lib/ssl.py:1478-1481` assigns `self._ech_config = ech_config` before `if self._sslobj is not None: self._sslobj.set_ech_config(ech_config)`.

On a connected client socket `self._sslobj` is not `None`, so the C call is entered with the cache already mutated.

`Modules/_ssl.c:2242-2255` then validates: rejects non-client `socket_type`, rejects `!SSL_in_before(self->ssl)` after handshake, and calls `ech_store_from_config()` returning `NULL` for unparsable input.

`Modules/_ssl.c:5318-5337` shows that path: `BIO_write` / `OSSL_ECHSTORE_read_echconfiglist` failure or `num_entries == 0` goes to `fail` with `_setSSLError()` and `return NULL`, so `SSL_set1_echstore()` is never reached.

Result: `self._ech_config` remains the invalid bytes while the underlying `SSL` keeps its prior store.

`Lib/ssl.py:1493-1495` (`_real_close`: `self._sslobj = None`) does not clear `self._ech_config`.

`Lib/ssl.py:1520-1521` (`_real_connect`: `if self._ech_config is not None: self._sslobj.set_ech_config(self._ech_config)`) reapplies that stale value to the fresh `SSL` object, so the next connect raises the same `SSLError`/`ValueError` again.
