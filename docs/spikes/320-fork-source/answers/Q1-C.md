# Q1 (why) — source C

In `Modules/_ssl.c:79-82`:
```c
#if OPENSSL_VERSION_NUMBER >= 0x40000000L && !defined(OPENSSL_NO_ECH)
#  define HAVE_OPENSSL_ECH 1
#  include "openssl/ech.h"
#endif
```
`Doc/library/ssl.rst:1025-1030` states: `HAS_ECH` means OpenSSL `4.0 or later with ECH enabled`.

All ECH bindings require that macro:

* `Modules/_ssl.c:7388-7399`: `ECH_STATUS_*` only under `#ifdef HAVE_OPENSSL_ECH`.
* `Modules/_ssl.c:7491-7494`: `OP_ECH_GREASE/TRIALDECRYPT/IGNORE_CID/GREASE_RETRY_CONFIG` only under same guard.
* `Modules/_ssl.c:7623-7627`: `addbool(m,"HAS_ECH",1)` else `0`.
* `Modules/clinic/_ssl.c.h:159,186,213,1287,2165,2207`: `get_ech_status/get_ech_retry_config/set_ech_config/_set_outer_alpn_protocols/load_ech_keys` wrapped in `#if defined(HAVE_OPENSSL_ECH)`, with empty `METHODDEF` fallbacks at `Modules/clinic/_ssl.c.h:3293-3319`.
* `Lib/ssl.py:155-159`: `ECHStatus` only `if HAS_ECH:`.
* `Lib/ssl.py:538-541,866-870,1021-1036,1168-1173,1476-1491`: `set_outer_alpn_protocols/outer_server_hostname/set_ech_config/get_ech_status/get_ech_retry_config` only `if HAS_ECH:`.

On older OpenSSL `Lib/test/test_ssl.py:2074-2095` asserts `hasattr(...,name)==ssl.HAS_ECH`, so lookups fail when `False`.

Passing `ech_config` fails explicitly: `Lib/ssl.py:399-400` in `_check_sslobject_params`:
```python
if ech_config is not None and not HAS_ECH:
    raise NotImplementedError("ECH is not supported by the OpenSSL library")
```
`Doc/library/ssl.rst:2255-2257` documents for `wrap_socket`/`wrap_bio`: specifying `ech_config` raises `NotImplementedError` if `HAS_ECH` is `False`.
