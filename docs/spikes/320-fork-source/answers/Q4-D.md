# Q4 (test-coverage) — source D

`Lib/test/test_ssl.py:2048` defines `class ECHTests`.

Gate when most skipped: `Lib/test/test_ssl.py:2049-2053` defines `requires_ech_x25519 = unittest.skipUnless(ssl.HAS_ECH and 'x25519' in ...get_groups(), ...)`; tests using it are skipped without ECH build support plus X25519. Remainder use `Lib/test/test_ssl.py:2097,2441,2454,2465,2478` form `@unittest.skipUnless(ssl.HAS_ECH, 'requires ECH')`.

Covers:

* Fixture `ECH_CONFIG` localhost X25519/HKDF-SHA256/AES-128-GCM list: `Lib/test/test_ssl.py:2055-2060`.
* API availability across `ssl`/`_ssl`, `ECHStatus`, `SSLECHRejectedError`, context/socket methods: `Lib/test/test_ssl.py:2073-2095`.
* `None`/`b''` behavior with no `SSL` object: `Lib/test/test_ssl.py:2098-2106`.
* `set_ech_config` type/buffer handling and invalid inputs: `Lib/test/test_ssl.py:2109-2125`; Base64 input: `Lib/test/test_ssl.py:2128-2130`; mixed supported/unsupported versions: `Lib/test/test_ssl.py:2145-2155`; unsupported KEM/KDF/AEAD suites: `Lib/test/test_ssl.py:2158-2175`.
* Client/server role errors for `set_ech_config`/`load_ech_keys`: `Lib/test/test_ssl.py:2133-2142`.
* Helpers to read `ech*.pem`, corrupt HPKE key, drive BIO handshake, echo over socketpair: `Lib/test/test_ssl.py:2177-2213`.
* Per-connection `ech_config` override, post-handshake/server-mode errors, unconnected-socket caching: `Lib/test/test_ssl.py:2216-2257`; stale-config rejection, `ECH_REQUIRED`/`retry_config`, retry connects and echo: `Lib/test/test_ssl.py:2260-2296`; successful handshake, SNI, I/O, GREASE retry-config: `Lib/test/test_ssl.py:2380-2420`; rejected handshake without server ECH: `Lib/test/test_ssl.py:2490-2512`; allocation-failure path: `Lib/test/test_ssl.py:2514-2530`.
* Outer ALPN set/validation and independence from inner ALPN, including rejection case: `Lib/test/test_ssl.py:2299-2322,2442-2476`.
* `load_ech_keys` paths, mismatched/encrypted/password-callback cases: `Lib/test/test_ssl.py:2325-2377`.
* `NOT_TRIED`/`NOT_CONFIGURED` before handshake and GREASE status: `Lib/test/test_ssl.py:2423-2488`.
