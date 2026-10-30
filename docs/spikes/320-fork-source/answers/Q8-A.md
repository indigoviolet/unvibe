# Q8 (edge) — source A

- Before handshake: `b""` — `Lib/test/test_ssl.py:2439` asserts `get_ech_retry_config()==b""` for configured and unconfigured objects pre-handshake.
- Reason: `Modules/_ssl.c:2212-2217` calls `SSL_ech_get1_retry_config()`; on failure sets `config_len=0` and builds zero-length `bytes`, so no config yet means `b""`. Python `SSLObject` wrapper passes that through: `Lib/ssl.py:1034-1036`.
- With no `SSL` object: `None` — documented at `Doc/library/ssl.rst:1517-1523` as `None` when socket has no underlying `SSL` object.
- Reason: C guard `Modules/_ssl.c:2207-2209` does `Py_RETURN_NONE` if `self->ssl==NULL`; `SSLSocket` guard `Lib/ssl.py:1489-1491` only delegates `if self._sslobj is not None`, otherwise returns implicit `None`. Tested at `Lib/test/test_ssl.py:2103,2106`.
- After handshake where server never authenticated: `b""` — `Lib/test/test_ssl.py:2512` asserts `b""` after ECH rejection by unauthenticated server; `Lib/test/test_ssl.py:2501` asserts `retry_config==b""` for server without ECH.
- Reason: `Modules/_ssl.c:2213-2215` comment `OpenSSL does not release unauthenticated retry configurations`, clears error and forces empty; same rule for exception attribute at `Modules/_ssl.c:650-656`: `only releases retry configurations once the outer handshake has authenticated the server; otherwise report none`.
