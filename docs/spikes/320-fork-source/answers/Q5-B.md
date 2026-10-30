# Q5 (cross-file, explored) — source B

In `Lib/ssl.py`, `SSLContext.wrap_socket(sock,...,ech_config=None)` (`Lib/ssl.py:478-493`) and `wrap_bio(...,ech_config=None)` (`Lib/ssl.py:495-503`) forward to `SSLSocket._create` / `SSLObject._create`.

Both `_create` paths first call `_check_sslobject_params` (`Lib/ssl.py:843-845`, `Lib/ssl.py:1067-1069`): `server_side+ech_config` → `ValueError` (`Lib/ssl.py:396-398`), `ech_config` without `HAS_ECH` → `NotImplementedError` (`Lib/ssl.py:399-400`).

`SSLObject._create` then does `context._wrap_bio(...)` plus `sslobj.set_ech_config(ech_config)` if set (`Lib/ssl.py:847-853`). `SSLSocket._create` caches `self._ech_config=ech_config` (`Lib/ssl.py:1083`), creates `self._sslobj` (`Lib/ssl.py:1139-1141`), then `self._sslobj.set_ech_config(self._ech_config)` (`Lib/ssl.py:1142-1143`); `SSLSocket.set_ech_config` re-caches then delegates (`Lib/ssl.py:1478-1481`), and `_real_connect` re-applies cache on lazy connect (`Lib/ssl.py:1520-1521`).

In `Modules/_ssl.c`, `_ssl._SSLSocket.set_ech_config_impl` (`Modules/_ssl.c:2242-2278`) validates: non-client → `ValueError` (`Modules/_ssl.c:2242-2246`), `!SSL_in_before` → `ValueError` (`Modules/_ssl.c:2247-2251`).

Transform in `ech_store_from_config` (`Modules/_ssl.c:5300-5338`): `len>INT_MAX` → `OverflowError`, `BIO_new`+`OSSL_ECHSTORE_new`, `BIO_write`+`OSSL_ECHSTORE_read_echconfiglist` (accepts binary or Base64), `OSSL_ECHSTORE_num_entries==0` → `ERR_R_PASSED_INVALID_ARGUMENT`.

Install: `SSL_set1_echstore(ssl,store)` (`Modules/_ssl.c:2257-2262`) for sockets, `SSL_CTX_set1_echstore` under `tstate_mutex` (`Modules/_ssl.c:5369-5376`) for `SSLContext.set_ech_config` after `PROTOCOL_TLS_SERVER` rejection (`Modules/_ssl.c:5358-5363`). Socket path then restores context outer-ALPN via `SSL_ech_set1_outer_alpn_protos` (`Modules/_ssl.c:2265-2272`); `newPySSLSocket` clears it when status is `NOT_CONFIGURED/GREASE` (`Modules/_ssl.c:980-994`).
