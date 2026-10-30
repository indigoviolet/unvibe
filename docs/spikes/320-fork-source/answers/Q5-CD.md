# Q5 (cross-file, explored) — source CD

In `Lib/ssl.py`:

* `SSLContext.wrap_socket(..., ech_config=None)` at `Lib/ssl.py:481` and `wrap_bio(..., ech_config=None)` at `Lib/ssl.py:496` forward to `SSLSocket._create(..., ech_config)` at `Lib/ssl.py:492` and `SSLObject._create(..., ech_config)` at `Lib/ssl.py:502`.
* `_check_sslobject_params` at `Lib/ssl.py:386` validates: `server_side+ech_config→ValueError` at `Lib/ssl.py:396-398`; `ech_config and not HAS_ECH→NotImplementedError` at `Lib/ssl.py:399-400`.
* `SSLObject._create` at `Lib/ssl.py:841-842` re-validates, calls `context._wrap_bio` at `Lib/ssl.py:847-850`, then immediately `sslobj.set_ech_config(ech_config)` at `Lib/ssl.py:852-853`.
* `SSLSocket._create` caches `self._ech_config=ech_config` at `Lib/ssl.py:1083`, then after `_wrap_socket` does `self._sslobj.set_ech_config(self._ech_config)` at `Lib/ssl.py:1142-1143`; unconnected reconnect repeats it in `_real_connect` at `Lib/ssl.py:1520-1521`. `SSLSocket.set_ech_config` at `Lib/ssl.py:1478-1481` updates cache then delegates if connected; `SSLObject.set_ech_config` at `Lib/ssl.py:1022-1028` delegates directly.
* Clinic `PyObject_GetBuffer(...,PyBUF_SIMPLE)` at `Modules/clinic/_ssl.c.h:236-240` accepts bytes-like as `Py_buffer`.

In `Modules/_ssl.c`:

* `_SSLSocket.set_ech_config_impl` at `Modules/_ssl.c:2239` rejects `socket_type!=PY_SSL_CLIENT` at `Modules/_ssl.c:2242-2245` and `!SSL_in_before` at `Modules/_ssl.c:2247-2250`.
* `ech_store_from_config` at `Modules/_ssl.c:5300` transforms: `len>INT_MAX→OverflowError` at `Modules/_ssl.c:5302-5305`; `BIO_write+OSSL_ECHSTORE_read_echconfiglist` at `Modules/_ssl.c:5318-5319`; `num_entries==0→ERR_R_PASSED_INVALID_ARGUMENT` at `Modules/_ssl.c:5326-5329`.
* Installs via `SSL_set1_echstore(self->ssl,store)` at `Modules/_ssl.c:2257`, then restores context outer-ALPN via `SSL_ech_set1_outer_alpn_protos` at `Modules/_ssl.c:2268-2270`.
* `_SSLContext.set_ech_config_impl` at `Modules/_ssl.c:5354` rejects `PROTOCOL_TLS_SERVER` at `Modules/_ssl.c:5358-5362`, then installs via `SSL_CTX_set1_echstore` at `Modules/_ssl.c:5370`.
