# Q4 (test-coverage) — source C

`Lib/test/test_ssl.py:2048` adds `class ECHTests(unittest.TestCase)` with `ECH_CONFIG` localhost fixture `Lib/test/test_ssl.py:2056-2060`.

Skipping: `Lib/test/test_ssl.py:2049-2053` defines `requires_ech_x25519=skipUnless(ssl.HAS_ECH and 'x25519' in ...get_groups())`; most tests use it and skip without OpenSSL-4.0 ECH plus X25519. `Lib/test/test_ssl.py:2097,2441,2454,2465,2478` use `skipUnless(ssl.HAS_ECH)` only. `Lib/test/test_ssl.py:2073-2095` `test_availability` is unskipped, asserting `hasattr(ssl,'ECHStatus')==HAS_ECH`, `ECH_STATUS_/OP_ECH_` presence, `SSLECHRejectedError` subclassing `SSLError`, and context/socket method presence.

Coverage:
* `Lib/test/test_ssl.py:2098-2106`: `None` status/retry/outer-name without `SSL` object.
* `Lib/test/test_ssl.py:2109-2130`: `set_ech_config` accepts `bytes/bytearray/memoryview`, releases buffer, rejects `None/str/int` with `TypeError` and truncated/invalid with `SSLError`; Base64 accepted.
* `Lib/test/test_ssl.py:2133-2155`: role checks — server `set_ech_config` raises `PROTOCOL_TLS_SERVER`, client `load_ech_keys` raises `PROTOCOL_TLS_CLIENT`; mixed supported/unsupported versions.
* `Lib/test/test_ssl.py:2158-2175`: unsupported KEM/KDF/AEAD rejects whole list.
* `Lib/test/test_ssl.py:2216-2296`: per-connection `ech_config` overrides stale context config, `ValueError` after handshake/server-side, retry flow: `SSLECHRejectedError/ECH_REQUIRED`, `retry_config` reusable for socket and BIO pairs.
* `Lib/test/test_ssl.py:2299-2322,2444-2476`: outer vs inner ALPN selection and validation.
* `Lib/test/test_ssl.py:2325-2377`: `load_ech_keys` path types, `OSError/ValueError/TypeError/SSLError` cases, encrypted-key passwords/callables, failed loads leave keys usable.
* `Lib/test/test_ssl.py:2380-2420`: successful handshake for two `config_id`s, `ECH_STATUS_SUCCESS`, `outer_server_hostname=='public.example'`, inner-name `sni_callback`.
* `Lib/test/test_ssl.py:2423-2488,2504-2530`: `NOT_TRIED/NOT_CONFIGURED/GREASE/FAILED` statuses, empty retry when server has no ECH, `nomemtest` allocation failure.
