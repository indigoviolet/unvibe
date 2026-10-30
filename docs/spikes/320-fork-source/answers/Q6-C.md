# Q6 (where) — source C

`SSLContext.load_ech_keys` is server-side only:

* `Modules/_ssl.c:5443-5446` rejects `PY_SSL_VERSION_TLS_CLIENT` with `Cannot load ECH keys into a PROTOCOL_TLS_CLIENT context`.
* `Doc/library/ssl.rst:1834` documents same: `Raises SSLError if context uses PROTOCOL_TLS_SERVER` [sic: `PROTOCOL_TLS_CLIENT` in code]; `Lib/test/test_ssl.py:2137-2138` tests `client_ctx.load_ech_keys` raises `PROTOCOL_TLS_CLIENT`.

File format:

* `Modules/_ssl.c:5430` / `Doc/library/ssl.rst:1823-1824`: file must be PEM `private key followed by its ECHConfigList`; `keyfile` is converted with `PyUnicode_FSConverter` and opened with `BIO_new_file(filename,"rb")` per `Modules/_ssl.c:5452,5471`.
* Key read with `PEM_read_bio_PrivateKey(bio,NULL,_password_callback,pw_info)` per `Modules/_ssl.c:5387-5388`.

`password` / encrypted keys:

* Signature `password=None, *, for_retry=True` per `Modules/_ssl.c:5423-5426`; docs `Modules/_ssl.c:5431-5433`: `string, bytes, bytearray, or callable`, only needed for encrypted keys.
* `Modules/_ssl.c:5455-5459`: if callable store as `pw_info.callable`, else `_pwinfo_set`; `Modules/_ssl.c:5483-5485`: if `pw_info.error`, callback exception propagates.

`for_retry`:

* `Modules/_ssl.c:5434-5435`: `If for_retry is true, advertise configurations in ECH retry responses`; `Doc/library/ssl.rst:1830-1832`: each call appends, `for_retry=True` includes new configs in retry configs.
* Implemented as `OSSL_ECHSTORE_set1_key_and_read_pem(store,key,bio,for_retry)` per `Modules/_ssl.c:5402-5404`; installed with `SSL_CTX_set1_echstore(ctx,store)` per `Modules/_ssl.c:5412`, under `tstate_mutex` + allow-threads per `Modules/_ssl.c:5468-5476`.

Duplicate key:

* `Modules/_ssl.c:5392-5400` reuses existing `SSL_CTX_get1_echstore` or creates new `OSSL_ECHSTORE`; `Modules/_ssl.c:5402-5404` counts keys before/after.
* `Modules/_ssl.c:5407-5410`: `if(new_keys<=old_keys){ERR_raise(...SSL_R_PRIVATE_KEY_MISMATCH);}` — requires new match even if OpenSSL matched existing key; failure returns `0` leading to `_setSSLError` per `Modules/_ssl.c:5491-5492`, i.e. `SSLError`.
