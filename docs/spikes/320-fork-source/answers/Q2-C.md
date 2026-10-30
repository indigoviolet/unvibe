# Q2 (where, explored) — source C

In `Modules/_ssl.c:775-779`, `PySSL_SetError` maps OpenSSL failure to new type:

> `if (ERR_GET_LIB(e) == ERR_LIB_SSL && ERR_GET_REASON(e) == SSL_R_ECH_REQUIRED)` then `type = state->PySSLECHRejectedErrorObject`.

Type defined in `Modules/_ssl.c:463-464` (`SSLECHRejectedError_doc`), registered in `Modules/_ssl.c:7308-7313` as `SSLECHRejectedError` subclass of `PySSLErrorObject` (`Modules/_ssl.h:26`), exported in `Lib/ssl.py:110-111`.

Extra data in `Modules/_ssl.c:646-662` inside `fill_and_set_sslerror`: when `type == PySSLECHRejectedErrorObject`:

* `Modules/_ssl.c:652-654`: call `SSL_ech_get1_retry_config(sslsock->ssl,&config,&config_len)`; on failure use `NULL,0` — comment `Modules/_ssl.c:650-651`: `OpenSSL only releases retry configurations once the outer handshake has authenticated the server`.
* `Modules/_ssl.c:656-660`: `PyBytes_FromStringAndSize(config,config_len)` + `PyObject_SetAttr(err_value, state->str_retry_config, retry_obj)` where `str_retry_config` is interned `"retry_config"` in `Modules/_ssl.c:7870-7871`.

Documented in `Doc/library/ssl.rst:339-342` as `retry_config`: server ECHConfigList or `b""` if none provided.
