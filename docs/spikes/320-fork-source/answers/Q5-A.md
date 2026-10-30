# Q5 (cross-file, explored) — source A

In `Lib/ssl.py` → `Modules/_ssl.c` → OpenSSL:

* `SSLContext.wrap_socket(sock,...,ech_config=None)` `Lib/ssl.py:481` and `wrap_bio(...ech_config=None)` `Lib/ssl.py:496` forward to `SSLSocket._create(...ech_config=ech_config)` `Lib/ssl.py:492` / `SSLObject._create(...ech_config=ech_config)` `Lib/ssl.py:502`.
* Validation layer 1 — ` _check_sslobject_params` `Lib/ssl.py:396-400`: `server_side+ech_config` → `ValueError: client mode`; `ech_config and not HAS_ECH` → `NotImplementedError`.
* `SSLObject._create` `Lib/ssl.py:841-853`: `_wrap_bio()` then `sslobj.set_ech_config(ech_config)` if not `None`; no caching.
* `SSLSocket._create` caches `self._ech_config=ech_config` `Lib/ssl.py:1083`, then after `_wrap_socket` does `self._sslobj.set_ech_config(self._ech_config)` `Lib/ssl.py:1142-1143`; same re-apply in `_real_connect` `Lib/ssl.py:1520-1521`. `SSLSocket.set_ech_config` `Lib/ssl.py:1478-1481` updates cache + delegates if connected.
* Validation layer 2 — `_ssl._SSLSocket.set_ech_config_impl` `Modules/_ssl.c:2242-2250`: `socket_type!=PY_SSL_CLIENT` → `ValueError`; `!SSL_in_before(ssl)` → `ValueError: after handshake`.
* Transform — `ech_store_from_config` `Modules/_ssl.c:5302-5329`: `len>INT_MAX` → `OverflowError`; `BIO_new+ BIO_write` raw `Py_buffer`, `OSSL_ECHSTORE_new` + `OSSL_ECHSTORE_read_echconfiglist` (binary or Base64 auto-detect); `OSSL_ECHSTORE_num_entries!=1` / `==0` → `SSLError`.
* Install — socket: `SSL_set1_echstore(ssl,store)` `Modules/_ssl.c:2257`, then restore context outer-ALPN `SSL_ech_set1_outer_alpn_protos` `Modules/_ssl.c:2267-2270`. Context: `_ssl._SSLContext.set_ech_config_impl` rejects `PROTOCOL_TLS_SERVER` `Modules/_ssl.c:5358-5362`, same transform, then `SSL_CTX_set1_echstore(ctx,store)` under `tstate_mutex` `Modules/_ssl.c:5369-5371`.
