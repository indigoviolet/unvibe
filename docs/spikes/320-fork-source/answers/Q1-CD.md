# Q1 (why) — source CD

In `Modules/_ssl.c:79-82` ECH is fenced by build:

> `#if OPENSSL_VERSION_NUMBER >= 0x40000000L && !defined(OPENSSL_NO_ECH)` / `#define HAVE_OPENSSL_ECH` / `#include "openssl/ech.h"`.

`Doc/library/ssl.rst:1025-1029` states `HAS_ECH` requires `OpenSSL 4.0 or later with ECH enabled`, because `SSL_ech_*`, `SSL_CTX_set1_echstore`, `OSSL_ECHSTORE_*` used in `Modules/_ssl.c:646-662,775-780,980-994,2238-2279,5299-5501` do not exist earlier.

On older OpenSSL:

* `Modules/_ssl.c:7623-7627`: `addbool(m,"HAS_ECH",1)` under `#ifdef HAVE_OPENSSL_ECH`, else `addbool(m,"HAS_ECH",0)`.
* `Modules/_ssl.c:7387-7399` and `Modules/_ssl.c:7491-7494`: `ECH_STATUS_*` and `OP_ECH_GREASE/TRIALDECRYPT/IGNORE_CID/GREASE_RETRY_CONFIG` are only `ADD_INT_CONST`/`ADD_OPTION` inside `#ifdef HAVE_OPENSSL_ECH`.
* `Modules/clinic/_ssl.c.h:3293-3320`: empty `#ifndef ...METHODDEF / #define ...` fallbacks, so `_ssl._SSLContext/_SSLSocket` have no `set_ech_config/load_ech_keys/_set_outer_alpn_protos/get_ech_status/get_ech_retry_config`.
* `Lib/ssl.py:155-159`, `Lib/ssl.py:538-541`, `Lib/ssl.py:866-870,1021-1036,1168-1173,1476-1491`: `ECHStatus`, `set_outer_alpn_protocols`, `outer_server_hostname`, `set_ech_config/get_ech_status/get_ech_retry_config` only defined `if HAS_ECH:`; verified by `Lib/test/test_ssl.py:2074-2095` checking `hasattr(...)==ssl.HAS_ECH`.
* `Lib/ssl.py:399-400`: `_check_sslobject_params` raises `NotImplementedError("ECH is not supported by the OpenSSL library")` if `ech_config is not None and not HAS_ECH`; documented in `Doc/library/ssl.rst:2255-2257` for `wrap_socket`/`wrap_bio`.
