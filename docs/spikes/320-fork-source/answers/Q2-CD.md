# Q2 (where, explored) — source CD

In `Modules/_ssl.c:7308-7313` `SSLECHRejectedError` is registered as subclass of `SSLError`:
`add_exception(state->PySSLECHRejectedErrorObject,"SSLECHRejectedError",SSLECHRejectedError_doc,state->PySSLErrorObject)`.

Mapping in `Modules/_ssl.c:775-780` inside `PySSL_SetError`:
```c
if (ERR_GET_LIB(e)==ERR_LIB_SSL &&
    ERR_GET_REASON(e)==SSL_R_ECH_REQUIRED) {
    type = state->PySSLECHRejectedErrorObject;
}
```
i.e. OpenSSL `SSL_R_ECH_REQUIRED` failure.

Extra data in `Modules/_ssl.c:646-661` inside `fill_and_set_sslerror`, only when `type==PySSLECHRejectedErrorObject`:
```c
if (SSL_ech_get1_retry_config(sslsock->ssl,&config,&config_len)!=1) {
    config=NULL; config_len=0;
}
retry_obj=PyBytes_FromStringAndSize((const char *)config,config_len);
OPENSSL_free(config);
if (PyObject_SetAttr(err_value,state->str_retry_config,retry_obj))
```
where `state->str_retry_config` is interned `"retry_config"` at `Modules/_ssl.c:7870-7872`.

Result documented in `Doc/library/ssl.rst:339-342`: `attribute retry_config`: server ECH retry `ECHConfigList`, or `b""` if server did not provide one; comment at `Modules/_ssl.c:650-651` clarifies `b""` when outer handshake has not authenticated server.
