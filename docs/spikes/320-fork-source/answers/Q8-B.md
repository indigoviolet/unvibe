# Q8 (edge) — source B

- No `SSL` object: `None`.
`Modules/_ssl.c:2207-2209`: `if(self->ssl==NULL){Py_RETURN_NONE;}`.
`Lib/ssl.py:1489-1491`: `SSLSocket.get_ech_retry_config` only `return`s `self._sslobj.get_ech_retry_config()` `if self._sslobj is not None`, otherwise implicit `None`; covered by `Lib/test/test_ssl.py:2103,2106` asserting `IsNone`.

- Before handshake with object: `b""`.
`Modules/_ssl.c:2212-2216`: if `SSL_ech_get1_retry_config()!=1`, `ERR_clear_error();config_len=0;`.
`Modules/_ssl.c:2217-2218`: then `PyBytes_FromStringAndSize(config,config_len)` -> empty bytes.
`Lib/test/test_ssl.py:2439`: `test_status_before_handshake` expects `get_ech_retry_config()==b''`.

- After handshake where server never authenticated: `b""`, same path.
`Modules/_ssl.c:2213-2214`: `// OpenSSL does not release unauthenticated retry configurations.`
`Modules/_ssl.c:650-654`: `/* OpenSSL only releases retry configurations once the outer handshake has authenticated the server; otherwise report none. */` then forces `config=NULL,config_len=0` on failure.
`Lib/test/test_ssl.py:2501,2512`: rejected client against server without ECH has `retry_config==b''` and `get_ech_retry_config()==b''`.
