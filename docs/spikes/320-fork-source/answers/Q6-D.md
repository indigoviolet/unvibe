# Q6 (where) — source D

`SSLContext.load_ech_keys` is server-side only:

- `Modules/_ssl.c:5443-5447` rejects `PY_SSL_VERSION_TLS_CLIENT` with `Cannot load ECH keys into a PROTOCOL_TLS_CLIENT context`.
- File must be `private key followed by its ECHConfigList`: `Doc/library/ssl.rst:1822-1824`, `Modules/_ssl.c:5430`.
- Path converted with `PyUnicode_FSConverter`: `Modules/_ssl.c:5452-5454`, opened `BIO_new_file(filename,"rb")` under `tstate_mutex` with threads released: `Modules/_ssl.c:5468-5477`.

Encrypted keys:

- Signature `keyfile,password=None,*,for_retry=True`: `Modules/clinic/_ssl.c.h:2210`, `Modules/_ssl.c:5422-5426`.
- `password` accepts `string, bytes, bytearray, or callable` as in `load_cert_chain`: `Doc/library/ssl.rst:1826-1829`, `Modules/_ssl.c:5431-5433`.
- `Modules/_ssl.c:5455-5461`: if `callable` store in `pw_info.callable`, else `_pwinfo_set(...,"password should be a string or callable")`.
- Key read via `PEM_read_bio_PrivateKey(bio,NULL,_password_callback,pw_info)`: `Modules/_ssl.c:5387-5388`. Tested with `ech-encrypted.pem` (`openssl pkey -aes-256-cbc -passout pass:somepass`) using direct and `lambda:` passwords: `Lib/test/test_ssl.py:2363-2369`.

`for_retry` and duplicates, `Modules/_ssl.c:5381-5418` `load_ech_keys(ctx,bio,for_retry,pw_info)`:

- Reuses `SSL_CTX_get1_echstore(ctx)` or `OSSL_ECHSTORE_new`: `Modules/_ssl.c:5392-5400`.
- `OSSL_ECHSTORE_num_keys(store,&old_keys)` then `OSSL_ECHSTORE_set1_key_and_read_pem(store,key,bio,for_retry)`: `Modules/_ssl.c:5402-5403`. Documented as `If for_retry is true, advertise configurations in retry responses` / `included in retry configurations`: `Modules/_ssl.c:5434-5435`, `Doc/library/ssl.rst:1830-1832`.
- Requires `new_keys>old_keys`, else `ERR_raise(ERR_LIB_SSL,SSL_R_PRIVATE_KEY_MISMATCH)`: `Modules/_ssl.c:5407-5411`, then `SSL_CTX_set1_echstore`: `Modules/_ssl.c:5412`.
- Failure maps to existing password exception, `OSError` on open with `errno`, else `SSLError`: `Modules/_ssl.c:5482-5493`.
