# Q7 (why) — source B

In `Modules/_ssl.c:981-990` `newPySSLSocket()` handles `PY_SSL_CLIENT` by calling `SSL_ech_get1_status()` and, if `status == SSL_ECH_STATUS_NOT_CONFIGURED || status == SSL_ECH_STATUS_GREASE`, calling `SSL_ech_set1_outer_alpn_protos(self->ssl, NULL, 0)`.

Reason is stated inline at `Modules/_ssl.c:986`: `/* OpenSSL also applies outer ALPN to ordinary and GREASE handshakes. */` — without the clear, a context-level outer list set via `SSL_CTX_ech_set1_outer_alpn_protos()` would be advertised in non-ECH handshakes.

`Modules/_ssl.c:2263-2270` in `_ssl__SSLSocket_set_ech_config_impl()` reverses that clear after `SSL_set1_echstore()` succeeds: comment `/* Restore the outer ALPN cleared when this socket was created without an ECH configuration. */`, then under `Py_BEGIN_CRITICAL_SECTION2` re-applies `ctx->outer_alpn_protocols/ctx->outer_alpn_protocols_len` with `SSL_ech_set1_outer_alpn_protos()` if non-`NULL`.
