# Q8 (edge) — source C

- Before handshake: `b""`.
  - `SSLSocket.get_ech_retry_config` delegates to `_ssl` when `_sslobj` exists: `Lib/ssl.py:1489-1491`.
  - C impl calls `SSL_ech_get1_retry_config`; on failure clears error and forces `config_len=0`, then builds empty `bytes`: `Modules/_ssl.c:2210-2217`.
  - Test expects `b""` for configured/unconfigured pre-handshake objects: `Lib/test/test_ssl.py:2439`.

- Socket with no `SSL` object: `None`.
  - Documented: return `None` if no underlying `SSL` object, e.g. before connect/after close: `Doc/library/ssl.rst:1519-1523`.
  - Python guard `if self._sslobj is not None` falls through to implicit `None`: `Lib/ssl.py:1490-1491`.
  - C guard `if (self->ssl == NULL) Py_RETURN_NONE`: `Modules/_ssl.c:2207-2209`.

- After handshake where server never authenticated: `b""`.
  - Same `!=1` path: OpenSSL “does not release unauthenticated retry configurations”: `Modules/_ssl.c:2212-2215`.
  - Same rule for exception attr: “only releases retry configurations once the outer handshake has authenticated the server; otherwise report none”: `Modules/_ssl.c:650-654`.
  - Rejected-by-non-ECH-server test expects `retry_config == b""` and `get_ech_retry_config() == b""`: `Lib/test/test_ssl.py:2501`, `Lib/test/test_ssl.py:2512`.
