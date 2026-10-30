# Q2 (where, explored) — source D

In `Modules/_ssl.c`, `PySSL_SetError()` maps OpenSSL failure `ERR_LIB_SSL` / `SSL_R_ECH_REQUIRED` to the new type:

* `Modules/_ssl.c:776-779`: `if (ERR_GET_LIB(e)==ERR_LIB_SSL && ERR_GET_REASON(e)==SSL_R_ECH_REQUIRED) type=state->PySSLECHRejectedErrorObject;`
* Registered in `Modules/_ssl.c:7308-7313` as `SSLECHRejectedError` subclass of `PySSLErrorObject`, re-exported in `Lib/ssl.py:110-111`.

When raised via `fill_and_set_sslerror()`, it carries `retry_config: bytes`:

* `Modules/_ssl.c:646-652`: only if `sslsock!=NULL && type==PySSLECHRejectedErrorObject`, call `SSL_ech_get1_retry_config(sslsock->ssl,&config,&config_len)`.
* `Modules/_ssl.c:652-657`: on failure return `!=1`, use `config=NULL,len=0`; then `PyBytes_FromStringAndSize(config,config_len)` so unauthenticated/missing becomes `b""`.
* `Modules/_ssl.c:660-661`: `PyObject_SetAttr(err_value,state->str_retry_config,retry_obj)`.
* `Modules/_ssl.c:7870-7872`: `str_retry_config` is interned `"retry_config"`.

Documented in `Doc/library/ssl.rst:324-342`: subclass of `SSLError` for server-rejected ECH, with `retry_config` ECHConfigList or `b""`.
