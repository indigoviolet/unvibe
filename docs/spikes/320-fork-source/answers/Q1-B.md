# Q1 (why) — source B

ECH APIs only exist in OpenSSL 4.0+:

* `Modules/_ssl.c:79-82` gates everything on `#if OPENSSL_VERSION_NUMBER >= 0x40000000L && !defined(OPENSSL_NO_ECH)` defining `HAVE_OPENSSL_ECH` and including `openssl/ech.h`.
* `Doc/library/ssl.rst:1025-1028` documents `HAS_ECH` as requiring `OpenSSL 4.0 or later with ECH enabled`.
* All bindings use that macro: `Modules/_ssl.c:2177-2281` `get_ech_status`/`get_ech_retry_config`/`set_ech_config`, `Modules/_ssl.c:4125-4162` `_set_outer_alpn_protocols`, `Modules/_ssl.c:5298-5502` `set_ech_config`/`load_ech_keys`, `Modules/_ssl.c:7387-7399` `ECH_STATUS_*`, `Modules/_ssl.c:7490-7495` `OP_ECH_*`.

On older OpenSSL:

* `Modules/_ssl.c:7623-7627` sets `HAS_ECH` to `0`.
* `Lib/ssl.py:155-159` only creates `ECHStatus` `if HAS_ECH:`, and `Lib/ssl.py:538-541`, `Lib/ssl.py:866-870`, `Lib/ssl.py:1021-1036`, `Lib/ssl.py:1168-1173`, `Lib/ssl.py:1476-1491` only define `set_outer_alpn_protocols`/`outer_server_hostname`/`set_ech_config`/`get_ech_status`/`get_ech_retry_config` `if HAS_ECH:`; `Lib/test/test_ssl.py:2073-2095` asserts `hasattr(...) == ssl.HAS_ECH`, so lookup fails.
* Passing a config still parses arguments via `Lib/ssl.py:385-400`, where `if ech_config is not None and not HAS_ECH: raise NotImplementedError("ECH is not supported by the OpenSSL library")`; `Doc/library/ssl.rst:2255-2257` documents `ech_config` raising `NotImplementedError` if `HAS_ECH` is `False`.
