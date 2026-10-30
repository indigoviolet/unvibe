# Q7 (why) — source D

In `Modules/_ssl.c:981-989`, `newPySSLSocket()` checks `SSL_ech_get1_status()` for client sockets and if `status == SSL_ECH_STATUS_NOT_CONFIGURED || status == SSL_ECH_STATUS_GREASE` calls `SSL_ech_set1_outer_alpn_protos(self->ssl, NULL, 0)`.

Reason per `Modules/_ssl.c:986`: `/* OpenSSL also applies outer ALPN to ordinary and GREASE handshakes. */` — context-level outer ALPN set via `SSL_CTX_ech_set1_outer_alpn_protos()` in `Modules/_ssl.c:4154-4156` would otherwise leak into non-ECH handshakes, so it is cleared at creation.

`_ssl._SSLSocket.set_ech_config` in `Modules/_ssl.c:2263-2270` reverses that:

* `Modules/_ssl.c:2263-2264`: `/* Restore the outer ALPN cleared when this socket was created without / * an ECH configuration. */`
* `Modules/_ssl.c:2267-2270`: if `ctx->outer_alpn_protocols != NULL`, calls `SSL_ech_set1_outer_alpn_protos(self->ssl, ctx->outer_alpn_protocols, ctx->outer_alpn_protocols_len)` under `Py_BEGIN_CRITICAL_SECTION2(self,ctx)` in `Modules/_ssl.c:2266`.

Thus a socket created without ECH has no outer ALPN; adding ECH per-connection re-applies the context's stored outer list from `Modules/_ssl.c:321-322`.
