# Q9 (follow-up, explored) — source CD

Fix check needs every read and write — tracing the remaining paths.
I've mapped all the cache sites — now pulling the exact code to verify the fix.
The connected case is covered — now checking whether deferred validation leaves a gap.
No — it fixes only the connected-socket variant.

* `Lib/ssl.py:1479-1481`: `SSLSocket.set_ech_config` does `self._ech_config=ech_config` then `if self._sslobj is not None: self._sslobj.set_ech_config(ech_config)`. Moved after, a failure of the `C` validator would skip the store, preserving the prior value reused by `Lib/ssl.py:1142-1143` in `SSLSocket._create` and `Lib/ssl.py:1520-1521` in `SSLSocket._real_connect`.

* Unconnected sockets have `self._sslobj is None`: `Lib/ssl.py:1083` caches `ech_config` in `_create` without validation when `connected==False`, leaving validation to `Lib/ssl.py:1520-1521`. The same is true for the setter guard at `Lib/ssl.py:1480`: when `None` no call happens, so order is irrelevant and any value is cached unvalidated.

* Hence `good` then `bad` while unconnected overwrites the good value with no error; the error appears only at the later `Lib/ssl.py:1521` `set_ech_config`. That handler at `Lib/ssl.py:1531-1532` clears `self._sslobj=None` but leaves `self._ech_config` as the bad value, so the next connect retries it.

* `Lib/ssl.py:853` and `Lib/ssl.py:1022-1028` (`SSLObject`) call `sslobj.set_ech_config` directly with no `_ech_config`, so unaffected.
