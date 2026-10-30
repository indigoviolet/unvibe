# Q5 (cross-file, explored) — source C

In `Lib/ssl.py`:

* `SSLContext.wrap_socket(..., ech_config=None)` at `Lib/ssl.py:481` forwards `ech_config=ech_config` to `SSLSocket._create` at `Lib/ssl.py:492`; `SSLContext.wrap_bio(..., ech_config=None)` at `Lib/ssl.py:496` forwards to `SSLObject._create` at `Lib/ssl.py:502`.
* Both `_create` call `_check_sslobject_params(..., ech_config)` at `Lib/ssl.py:844`/`Lib/ssl.py:1068`, defined at `Lib/ssl.py:385`: rejects `server_side+ech_config` with `ValueError` at `Lib/ssl.py:396` and `ech_config` without `HAS_ECH` with `NotImplementedError` at `Lib/ssl.py:399`.
* `SSLObject._create` at `Lib/ssl.py:841`: after `context._wrap_bio` at `Lib/ssl.py:847`, `if ech_config is not None: sslobj.set_ech_config(ech_config)` at `Lib/ssl.py:852`.
* `SSLSocket._create` at `Lib/ssl.py:1064`: caches `self._ech_config=ech_config` at `Lib/ssl.py:1083`, then after `_wrap_socket` at `Lib/ssl.py:1139`, `if self._ech_config is not None: self._sslobj.set_ech_config` at `Lib/ssl.py:1142`; same re-apply on deferred connect in `_real_connect` at `Lib/ssl.py:1520`. `SSLSocket.set_ech_config` at `Lib/ssl.py:1478` updates cache at `Lib/ssl.py:1479` then delegates at `Lib/ssl.py:1481`.

In `Modules/_ssl.c` + `Modules/clinic/_ssl.c.h`:

* Clinic `PyObject_GetBuffer(...,PyBUF_SIMPLE)` at `Modules/clinic/_ssl.c.h:236` (socket) / `Modules/clinic/_ssl.c.h:2189` (context) enforces bytes-like.
* `_ssl._SSLSocket.set_ech_config` at `Modules/_ssl.c:2239`: rejects non-client at `Modules/_ssl.c:2242`, post-handshake `!SSL_in_before` at `Modules/_ssl.c:2247`, then `ech_store_from_config` at `Modules/_ssl.c:2253` + `SSL_set1_echstore` at `Modules/_ssl.c:2257`, then restores `ctx->outer_alpn_protocols` via `SSL_ech_set1_outer_alpn_protos` at `Modules/_ssl.c:2268`.
* `ech_store_from_config` at `Modules/_ssl.c:5300`: `len>INT_MAX` check at `Modules/_ssl.c:5302`, `BIO_write`+`OSSL_ECHSTORE_read_echconfiglist` at `Modules/_ssl.c:5318`, `OSSL_ECHSTORE_num_entries`/`==0` check at `Modules/_ssl.c:5323`.
* `_ssl._SSLContext.set_ech_config` at `Modules/_ssl.c:5354`: rejects `PROTOCOL_TLS_SERVER` at `Modules/_ssl.c:5358`, then store + `SSL_CTX_set1_echstore` under `tstate_mutex` at `Modules/_ssl.c:5370`.
