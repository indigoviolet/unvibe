# Q1 (why) — source A

In `Modules/_ssl.c:79-82` the change defines `HAVE_OPENSSL_ECH` only when `OPENSSL_VERSION_NUMBER >= 0x40000000L && !defined(OPENSSL_NO_ECH)`, and only then includes `openssl/ech.h`.

All C ECH implementation is behind that macro: e.g. `OSSL_ECHSTORE`/ `SSL_ech_*` helpers in `Modules/_ssl.c:5298-5502`, socket methods in `Modules/_ssl.c:2177-2281`, constants `ECH_STATUS_*` in `Modules/_ssl.c:7387-7399` and `OP_ECH_*` in `Modules/_ssl.c:7490-7495`.

It is exposed as `HAS_ECH=1/0` in `Modules/_ssl.c:7623-7627`, documented in `Doc/library/ssl.rst:1025-1029` as requiring OpenSSL 4.0 or later with ECH enabled.

`Lib/ssl.py:155-159` defines `ECHStatus` only `if HAS_ECH:`; same for `SSLContext.set_outer_alpn_protocols` in `Lib/ssl.py:538-541`, `SSLObject.outer_server_hostname/set_ech_config/get_ech_status/get_ech_retry_config` in `Lib/ssl.py:866-870,1021-1036`, and `SSLSocket` equivalents in `Lib/ssl.py:1168-1173,1476-1491`. `Lib/test/test_ssl.py:2073-2095` asserts `hasattr(...)==HAS_ECH`, so on older OpenSSL those attributes are absent.

Passing `ech_config` without ECH fails in `Lib/ssl.py:399-400` with `NotImplementedError("ECH is not supported by the OpenSSL library")`, documented in `Doc/library/ssl.rst:2255-2257`; server-side use separately raises `ValueError` per `Lib/ssl.py:396-398`.

`SSLECHRejectedError` itself is still imported in `Lib/ssl.py:107-112` via unconditional `Modules/_ssl.c:7308-7313`, but its `ECH_REQUIRED` mapping in `Modules/_ssl.c:775-780` and `retry_config` filling in `Modules/_ssl.c:645-663` are `#ifdef HAVE_OPENSSL_ECH`, so it is never raised there.
