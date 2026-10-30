# Q1 (why) — source D

CPython gates ECH on the OpenSSL version because the implementation uses OpenSSL 4.0 ECH APIs:

* `Modules/_ssl.c:79-82` defines `HAVE_OPENSSL_ECH` only if `OPENSSL_VERSION_NUMBER >= 0x40000000L && !defined(OPENSSL_NO_ECH)` and includes `openssl/ech.h`.
* `Doc/library/ssl.rst:1025-1030` documents `HAS_ECH` as requiring `OpenSSL 4.0 or later with ECH enabled`.
* Constants/methods are `#ifdef HAVE_OPENSSL_ECH`: `Modules/_ssl.c:7387-7399` for `ECH_STATUS_*`, `Modules/_ssl.c:7490-7495` for `OP_ECH_*`, `Modules/_ssl.c:7623-7627` sets `HAS_ECH` to `1` or `0`.

On older OpenSSL `HAS_ECH` is `False`, and the new APIs are absent:

* `Lib/ssl.py:155-159` defines `ECHStatus` only `if HAS_ECH:`; `Lib/ssl.py:538-541`, `Lib/ssl.py:866-870`, `Lib/ssl.py:1021-1036`, `Lib/ssl.py:1168-1174`, `Lib/ssl.py:1476-1491` similarly guard `set_outer_alpn_protocols`, `outer_server_hostname`, `set_ech_config`, `get_ech_status`, `get_ech_retry_config`.
* `Modules/clinic/_ssl.c.h:3293-3303` and `Modules/clinic/_ssl.c.h:3313-3319` define empty `METHODDEF`s without `HAVE_OPENSSL_ECH`, so `_ssl` has no ECH methods.
* `Lib/test/test_ssl.py:2073-2095` asserts `hasattr(ssl,'ECHStatus')==ssl.HAS_ECH` and all `ECH_STATUS_*/OP_ECH_*` and context/socket ECH methods track `HAS_ECH`.

Passing `ech_config` fails fast:

* `Lib/ssl.py:399-400`: `if ech_config is not None and not HAS_ECH: raise NotImplementedError("ECH is not supported...")` in `_check_sslobject_params`.
* `Doc/library/ssl.rst:2255-2257`: `ech_config` raises `ValueError` if `server_side` is true, and `NotImplementedError` if `HAS_ECH` is `False`.
