# Q2 (where, explored) — source A

In `Modules/_ssl.c:776-779`, `PySSL_SetError()` maps OpenSSL failure to new type:

> `ERR_GET_LIB(e)==ERR_LIB_SSL && ERR_GET_REASON(e)==SSL_R_ECH_REQUIRED` -> `state->PySSLECHRejectedErrorObject`.

Registered in `Modules/_ssl.c:7308-7313` as `SSLECHRejectedError` with base `state->PySSLErrorObject`, documented in `Doc/library/ssl.rst:324-337` as `SSLError` subclass raised when server rejected ECH.

Extra data: `retry_config` attribute, interned in `Modules/_ssl.c:7870-7872` as `"retry_config"`.

In `Modules/_ssl.c:646-661`, `fill_and_set_sslerror()` when `type==PySSLECHRejectedErrorObject`:

* calls `SSL_ech_get1_retry_config(sslsock->ssl,&config,&config_len)` in `Modules/_ssl.c:652`; on failure clears to `NULL/0` per comment `Modules/_ssl.c:650-654` only authenticated retry configs released;
* builds `PyBytes_FromStringAndSize(config,config_len)` in `Modules/_ssl.c:656`;
* sets `err_value.retry_config` in `Modules/_ssl.c:660`.

Documented in `Doc/library/ssl.rst:339-342`: server ECH retry `ECHConfigList`, or `b""` if none. Exposed via `from _ssl import SSLECHRejectedError` in `Lib/ssl.py:110-111`.
