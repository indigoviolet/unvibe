# Q5 (cross-file, explored) — source D

`ech_config` path:

* `SSLContext.wrap_socket(..., ech_config=None)` at `Lib/ssl.py:478-481` forwards to `SSLSocket._create(..., ech_config=ech_config)` at `Lib/ssl.py:488-493`; `SSLContext.wrap_bio(..., ech_config=None)` at `Lib/ssl.py:495-496` forwards to `SSLObject._create(..., ech_config=ech_config)` at `Lib/ssl.py:499-503`.
* Validation in `_check_sslobject_params`: signature at `Lib/ssl.py:385-386`; `server_side+ech_config→ValueError` at `Lib/ssl.py:396-398`; `ech_config without HAS_ECH→NotImplementedError` at `Lib/ssl.py:399-400`; called from both `_create` paths at `Lib/ssl.py:843-845` and `Lib/ssl.py:1067-1069`.
* `SSLObject._create` at `Lib/ssl.py:841-853`: creates BIO object via `context._wrap_bio` at `Lib/ssl.py:847-851`, then `if ech_config is not None: sslobj.set_ech_config` at `Lib/ssl.py:852-853`.
* `SSLSocket._create` caches at `Lib/ssl.py:1083` (`self._ech_config=ech_config`), installs after `_wrap_socket` at `Lib/ssl.py:1142-1143` and after implicit connect in `_real_connect` at `Lib/ssl.py:1520-1521` via `self._sslobj.set_ech_config`.
* Python setters are thin: `SSLObject.set_ech_config` at `Lib/ssl.py:1022-1028` calls `self._sslobj.set_ech_config`; `SSLSocket.set_ech_config` at `Lib/ssl.py:1479-1481` caches then delegates if connected.
* Clinic `set_ech_config` at `Modules/clinic/_ssl.c.h:230-246` does `PyObject_GetBuffer(...,PyBUF_SIMPLE)` to `Py_buffer`.
* `PySSLSocket.set_ech_config_impl` at `Modules/_ssl.c:2238-2279`: rejects `socket_type!=PY_SSL_CLIENT` at `Modules/_ssl.c:2242-2245`, rejects `!SSL_in_before` at `Modules/_ssl.c:2247-2250`, builds store via `ech_store_from_config` at `Modules/_ssl.c:2253-2256`, installs via `SSL_set1_echstore` at `Modules/_ssl.c:2257-2258`, restores context outer-ALPN at `Modules/_ssl.c:2265-2270`.
* `ech_store_from_config` at `Modules/_ssl.c:5299-5338`: `len>INT_MAX→OverflowError` at `Modules/_ssl.c:5302-5305`, `BIO_write+OSSL_ECHSTORE_read_echconfiglist` at `Modules/_ssl.c:5318-5321`, `num_entries==0→SSLError` at `Modules/_ssl.c:5322-5329`.
* Context install `set_ech_config_impl` at `Modules/_ssl.c:5353-5378`: rejects `PROTOCOL_TLS_SERVER` at `Modules/_ssl.c:5358-5363`, then `SSL_CTX_set1_echstore` under lock at `Modules/_ssl.c:5369-5371`.
