# Q4 (test-coverage) — source CD

`Lib/test/test_ssl.py:2048` adds `class ECHTests(unittest.TestCase)` with `ECH_CONFIG` test vector at `Lib/test/test_ssl.py:2056-2060` and helpers `read_ech_key_and_config`, `stale_config`, `handshake_bio_pair`, `echo_server_thread` at `Lib/test/test_ssl.py:2177-2213`.

Covers:
* API availability: `test_availability` at `Lib/test/test_ssl.py:2073-2095` checks `ECHStatus`, `ECH_STATUS_`/`OP_ECH_` names, `SSLECHRejectedError` subclassing, context vs socket methods.
* Config parsing: `test_set_ech_config` at `Lib/test/test_ssl.py:2109-2125`, `test_set_ech_config_base64` at `Lib/test/test_ssl.py:2128-2130`, `test_mixed_ech_config_versions` at `Lib/test/test_ssl.py:2145-2155`, `test_mixed_ech_config_unsupported_suites` at `Lib/test/test_ssl.py:2158-2175`.
* Roles/connection config: `test_context_roles` at `Lib/test/test_ssl.py:2133-2142`, `test_connection_ech_config` at `Lib/test/test_ssl.py:2216-2257`.
* Handshake/retry: `test_rejected_ech_retry_config` at `Lib/test/test_ssl.py:2260-2296`, `test_ech_handshake` at `Lib/test/test_ssl.py:2380-2420`, `test_rejected_ech` at `Lib/test/test_ssl.py:2505-2512` via `make_rejected_client` at `Lib/test/test_ssl.py:2490-2502`.
* Keys: `test_load_ech_keys` at `Lib/test/test_ssl.py:2325-2360`, `test_load_ech_keys_password` at `Lib/test/test_ssl.py:2363-2377`.
* ALPN/GREASE/status: `test_outer_alpn_with_connection_ech_config` at `Lib/test/test_ssl.py:2299-2322`, `test_status_before_handshake` at `Lib/test/test_ssl.py:2423-2439`, `test_set_outer_alpn_protocols` at `Lib/test/test_ssl.py:2442-2452`, `test_outer_alpn_does_not_replace_inner` at `Lib/test/test_ssl.py:2455-2463`, `test_outer_alpn_without_ech_config` at `Lib/test/test_ssl.py:2466-2476`, `test_grease` at `Lib/test/test_ssl.py:2479-2488`, `test_socket_without_ssl_object` at `Lib/test/test_ssl.py:2098-2106`, `test_status_allocation_failure` at `Lib/test/test_ssl.py:2516-2530`.

Skipped when: most use `requires_ech_x25519` defined at `Lib/test/test_ssl.py:2049-2053` as `unittest.skipUnless(ssl.HAS_ECH and 'x25519' in ...get_groups(),'requires ECH with X25519')`; remainder use `@unittest.skipUnless(ssl.HAS_ECH,'requires ECH')` e.g. `Lib/test/test_ssl.py:2097,2441,2454,2465,2478,2541`. Only `test_availability` runs without ECH.
