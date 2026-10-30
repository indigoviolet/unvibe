# Q8 (edge) — source CD

- Before handshake, with `SSL` object present: `b""`.
  - `Doc/library/ssl.rst:1517-1521` documents `SSLSocket.get_ech_retry_config()` returns ECH retry configuration as `bytes`, or `b""` if no usable configuration available.
  - `Modules/_ssl.c:2210-2218`: `SSL_ech_get1_retry_config(self->ssl,&config,&config_len)!=1` -> `config_len=0`, then `PyBytes_FromStringAndSize(...,config_len)` yields `b""`.
  - `Lib/ssl.py:1034-1036` (`SSLObject`) returns that result directly; `Lib/ssl.py:1489-1491` (`SSLSocket`) returns it when `self._sslobj is not None`.

- Socket with no `SSL` object: `None`.
  - `Modules/_ssl.c:2207-2209`: `if(self->ssl==NULL){Py_RETURN_NONE;}` in `_ssl._SSLSocket.get_ech_retry_config_impl`.
  - `Lib/ssl.py:1489-1491`: `if self._sslobj is not None: return self._sslobj.get_ech_retry_config()` falls through to implicit `None`.
  - `Doc/library/ssl.rst:1522-1523`: `Return None if the socket has no underlying SSL object`.

- After handshake where server never authenticated: `b""`.
  - `Modules/_ssl.c:2212-2215`: on `SSL_ech_get1_retry_config!=1`, comment `OpenSSL does not release unauthenticated retry configurations`, `ERR_clear_error(); config_len=0;` -> empty `bytes`.
  - Same rule for exception path, `Modules/_ssl.c:650-657`: `OpenSSL only releases retry configurations once the outer handshake has authenticated the server; otherwise report none`, resetting to `NULL/0` before `PyBytes_FromStringAndSize`.
