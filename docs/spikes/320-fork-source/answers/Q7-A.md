# Q7 (why) — source A

In `Modules/_ssl.c:981-989` `newPySSLSocket()` checks `PY_SSL_CLIENT` sockets with `SSL_ech_get1_status()` and if `status==SSL_ECH_STATUS_NOT_CONFIGURED||status==SSL_ECH_STATUS_GREASE` calls `SSL_ech_set1_outer_alpn_protos(self->ssl,NULL,0)`:

> `OpenSSL also applies outer ALPN to ordinary and GREASE handshakes.` (`Modules/_ssl.c:986`)

That inherited `SSL_CTX` outer list would otherwise be sent on non-ECH handshakes. Outer list is stored per-context as `ctx->outer_alpn_protocols/_len` (`Modules/_ssl.c:321-322`) by `_ssl__SSLContext__set_outer_alpn_protocols_impl()` via `SSL_CTX_ech_set1_outer_alpn_protos()` (`Modules/_ssl.c:4154-4156`).

`_ssl__SSLSocket_set_ech_config_impl()` therefore restores it after `SSL_set1_echstore()` succeeds (`Modules/_ssl.c:2257-2270`): it re-takes `self->ctx` under `Py_BEGIN_CRITICAL_SECTION2`, and if `ctx->outer_alpn_protocols!=NULL` calls `SSL_ech_set1_outer_alpn_protos(self->ssl,ctx->outer_alpn_protocols,ctx->outer_alpn_protocols_len)` — explicitly `Restore the outer ALPN cleared when this socket was created without an ECH configuration` (`Modules/_ssl.c:2263-2264`).
