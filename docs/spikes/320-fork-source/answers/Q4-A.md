# Q4 (test-coverage) — source A

`Lib/test/test_ssl.py:2048` defines `class ECHTests` with `Lib/test/test_ssl.py:2056-2060` `ECH_CONFIG` bytes for `localhost` with `X25519/HKDF-SHA256/AES-128-GCM`.

Covered:

* Availability/shape: `Lib/test/test_ssl.py:2073-2095` checks `ECHStatus`, `ECH_STATUS_*`/`OP_ECH_*` presence equals `HAS_ECH`, `SSLECHRejectedError` subclassing, and context/socket method presence.
* No-SSL-object behavior: `Lib/test/test_ssl.py:2098-2106` expects `None` for `outer_server_hostname`/`get_ech_status`/`get_ech_retry_config`.
* Client config parsing: `Lib/test/test_ssl.py:2109-2125` accepts `bytes/bytearray/memoryview`, rejects `None/str/int` with `TypeError` and empty/truncated/invalid with `SSLError`; `Lib/test/test_ssl.py:2128-2130` accepts base64; `Lib/test/test_ssl.py:2145-2175` checks mixed versions/suites.
* Roles: `Lib/test/test_ssl.py:2133-2142` server `set_ech_config` and client `load_ech_keys` fail, generic `PROTOCOL_TLS` allows both.
* Keys: `Lib/test/test_ssl.py:2325-2360` path types, missing file, invalid/public-only/mismatched/encrypted PEM, prior keys remain usable; `Lib/test/test_ssl.py:2363-2377` password string/callable, failing callback, unencrypted with callback.
* Handshakes: `Lib/test/test_ssl.py:2380-2420` success for two `config_id`s, `outer_server_hostname=='public.example'`, SNI visibility, data exchange, GREASE `retry_config`; `Lib/test/test_ssl.py:2260-2296` stale-config `SSLECHRejectedError/ECH_REQUIRED`, retry usable via `wrap_socket`; `Lib/test/test_ssl.py:2216-2257` per-connection `ech_config` override.
* ALPN/GREASE/status: `Lib/test/test_ssl.py:2299-2322` outer selection on reject; `Lib/test/test_ssl.py:2442-2476` outer-ALPN setters/isolation; `Lib/test/test_ssl.py:2479-2488` `GREASE`; `Lib/test/test_ssl.py:2423-2439` `NOT_TRIED/NOT_CONFIGURED`; `Lib/test/test_ssl.py:2504-2530` rejected `FAILED` status and `nomemtest` allocation.

Skipped: most use `Lib/test/test_ssl.py:2049-2053` `requires_ech_x25519`, i.e. `skipUnless(ssl.HAS_ECH and 'x25519' in ...get_groups())`; remainder use `Lib/test/test_ssl.py:2097,2441,2454,2465,2478` `skipUnless(ssl.HAS_ECH,'requires ECH')`.
