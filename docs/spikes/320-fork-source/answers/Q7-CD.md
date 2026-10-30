# Q7 (why) — source CD

In `Modules/_ssl.c:981-989`, `newPySSLSocket()` for `PY_SSL_CLIENT` calls `SSL_ech_get1_status()` and if `status == SSL_ECH_STATUS_NOT_CONFIGURED || status == SSL_ECH_STATUS_GREASE` calls `SSL_ech_set1_outer_alpn_protos(self->ssl, NULL, 0)`.

Reason is stated at `Modules/_ssl.c:986`: `/* OpenSSL also applies outer ALPN to ordinary and GREASE handshakes. */` — without clearing, a context-level outer list set via `SSL_CTX_ech_set1_outer_alpn_protos()` in `Modules/_ssl.c:4154-4156` (stored in `Modules/_ssl.c:321-322` `outer_alpn_protocols/_len`) would be inherited by `SSL_new` and sent on non-ECH handshakes.

`_ssl._SSLSocket.set_ech_config` at `Modules/_ssl.c:2263-2271` reverses that:

* comment at `Modules/_ssl.c:2263-2264`: `/* Restore the outer ALPN cleared when this socket was created without an ECH configuration. */`
* after `SSL_set1_echstore()` succeeds, it takes `self`+`ctx` lock and if `ctx->outer_alpn_protocols != NULL` calls `SSL_ech_set1_outer_alpn_protos()` with the context values.

Failure to clear at creation (`Modules/_ssl.c:989-992`) or to restore after `set_ech_config` (`Modules/_ssl.c:2274-2277`) raises via `_setSSLError()`.
