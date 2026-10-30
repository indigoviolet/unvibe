# Q8 (edge) — source D

- No `SSL` object: returns `None`.
  - `Modules/_ssl.c:2207-2209`: `if (self->ssl == NULL) { Py_RETURN_NONE; }`.
  - `Lib/ssl.py:1489-1491`: `SSLSocket.get_ech_retry_config` only returns `self._sslobj.get_ech_retry_config()` `if self._sslobj is not None`, otherwise implicit `None`.
  - Documented in `Doc/library/ssl.rst:1519-1523`: `Return None if the socket has no underlying SSL object`.
  - Tested in `Lib/test/test_ssl.py:2103-2106`: `assertIsNone(sock.get_ech_retry_config())` before connect/after close.

- Before handshake with object: returns `b""`.
  - `Modules/_ssl.c:2210-2218`: `config=NULL,config_len=0`; if `SSL_ech_get1_retry_config(...) != 1` set `config_len=0` then `PyBytes_FromStringAndSize(...,config_len)` -> empty bytes.
  - Tested in `Lib/test/test_ssl.py:2439`: `assertEqual(obj.get_ech_retry_config(), b'')` for `NOT_TRIED`/`NOT_CONFIGURED`.

- After handshake where server never authenticated: returns `b""`, same failure path.
  - `Modules/_ssl.c:2212-2215`: on `!=1`, `ERR_clear_error(); config_len=0` with comment `// OpenSSL does not release unauthenticated retry configurations.`
  - Same rule for exception attribute in `Modules/_ssl.c:650-654`: `/* OpenSSL only releases retry configurations once the outer handshake has authenticated the server; otherwise report none. */`
  - Tested in `Lib/test/test_ssl.py:2497-2501` and `2512`: rejected client against server without ECH has `retry_config == b''` and `get_ech_retry_config() == b''`.
