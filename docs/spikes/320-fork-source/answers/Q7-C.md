# Q7 (why) — source C

In `Modules/_ssl.c:981-989`, `newPySSLSocket()` queries `SSL_ech_get1_status()` immediately after `SSL_new()` and if `status == SSL_ECH_STATUS_NOT_CONFIGURED || status == SSL_ECH_STATUS_GREASE` calls `SSL_ech_set1_outer_alpn_protos(self->ssl,NULL,0)`.

Reason per `Modules/_ssl.c:986`: `/* OpenSSL also applies outer ALPN to ordinary and GREASE handshakes. */` — the context-level outer ALPN set via `SSL_CTX_ech_set1_outer_alpn_protos()` is inherited by new `SSL*`, so it must be cleared when the socket has no real ECH attempt to avoid altering non-ECH/GREASE negotiation.

`Modules/_ssl.c:2263-2270` in `_ssl._SSLSocket.set_ech_config` reverses that: after `SSL_set1_echstore()` succeeds it re-acquires `self->ctx` and if `ctx->outer_alpn_protocols != NULL` calls `SSL_ech_set1_outer_alpn_protos()` with the context value. Comment at `Modules/_ssl.c:2263-2264`: `/* Restore the outer ALPN cleared when this socket was created without an ECH configuration. */`.
