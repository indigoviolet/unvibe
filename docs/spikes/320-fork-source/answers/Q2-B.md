# Q2 (where, explored) — source B

In `Modules/_ssl.c:776-778` `PySSL_SetError()` maps handshake failure to new type:

> `if (ERR_GET_LIB(e)==ERR_LIB_SSL && ERR_GET_REASON(e)==SSL_R_ECH_REQUIRED) type=state->PySSLECHRejectedErrorObject;` guarded by `HAVE_OPENSSL_ECH`.

Registered in `Modules/_ssl.c:7308-7313` as subclass of `SSLError` (`SSLECHRejectedError_doc` at `Modules/_ssl.c:463-464`).

Extra data in `Modules/_ssl.c:646-661` `fill_and_set_sslerror()`: only when `sslsock!=NULL && type==PySSLECHRejectedErrorObject`:

* calls `SSL_ech_get1_retry_config(sslsock->ssl,&config,&config_len)` (`Modules/_ssl.c:652`);
* on failure `!=1` sets `config=NULL,config_len=0` (`Modules/_ssl.c:653-654`) — comment `Modules/_ssl.c:650-651`: only authenticated outer-handshake configs released;
* builds `PyBytes_FromStringAndSize(config,config_len)` (`Modules/_ssl.c:656`), `OPENSSL_free(config)` (`Modules/_ssl.c:657`), attaches as `retry_config` via `PyObject_SetAttr(err_value,state->str_retry_config,retry_obj)` (`Modules/_ssl.c:660`).

Documented in `Doc/library/ssl.rst:339-342`: `retry_config` is `ECHConfigList` or `b""` if server provided none.
