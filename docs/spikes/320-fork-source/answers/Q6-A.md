# Q6 (where) — source A

`SSLContext.load_ech_keys` in `Modules/_ssl.c:5438-5501`:

* Server-only: rejects `PY_SSL_VERSION_TLS_CLIENT` with `Cannot load ECH keys into a PROTOCOL_TLS_CLIENT context` (`Modules/_ssl.c:5443-5448`), documented in `Doc/library/ssl.rst:1834`.
* Format: file must contain `private key followed by its ECHConfigList` (`Modules/_ssl.c:5430`, `Doc/library/ssl.rst:1822-1824`). Helper reads key via `PEM_read_bio_PrivateKey(bio,NULL,_password_callback,pw_info)` (`Modules/_ssl.c:5387-5388`), then `OSSL_ECHSTORE_set1_key_and_read_pem(store,key,bio,for_retry)` (`Modules/_ssl.c:5402-5404`).
* Accumulates: gets existing store via `SSL_CTX_get1_echstore(ctx)` or `OSSL_ECHSTORE_new(NULL,NULL)` if empty (`Modules/_ssl.c:5392-5400`), then `SSL_CTX_set1_echstore(ctx,store)` (`Modules/_ssl.c:5412`). Docs: `Each call adds keys and configurations to those already loaded` (`Doc/library/ssl.rst:1830-1831`).
* `for_retry`: clinic `for_retry: bool=True` (`Modules/_ssl.c:5426`); `If for_retry is true, advertise the configurations in ECH retry responses` (`Modules/_ssl.c:5434-5435`), `included in ECH retry configurations sent to clients` (`Doc/library/ssl.rst:1830-1832`).
* Encrypted keys: `password` may be `string, bytes, bytearray, or callable` (`Modules/_ssl.c:5431-5433`, `Doc/library/ssl.rst:1826-1828`); `PyCallable_Check(password)` stored as callback else `_pwinfo_set` (`Modules/_ssl.c:5455-5462`). Example `Lib/test/certdata/ech-encrypted.pem:1-6` is `ENCRYPTED PRIVATE KEY` + `ECHCONFIG`.
* Duplicate: compares `OSSL_ECHSTORE_num_keys` before/after (`Modules/_ssl.c:5402-5404`); `if(new_keys<=old_keys)` raises `SSL_R_PRIVATE_KEY_MISMATCH` (`Modules/_ssl.c:5408-5410`) per `We want to require a new match` (`Modules/_ssl.c:5407`), surfaced via `_setSSLError` (`Modules/_ssl.c:5492`).
