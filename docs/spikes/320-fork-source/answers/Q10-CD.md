# Q10 (cross-file) — source CD

`ECHStatus` is built in `Lib/ssl.py:155-159` via:

```python
_IntEnum._convert_('ECHStatus',__name__,lambda name:name.startswith('ECH_STATUS_'),source=_ssl)
```

sourcing integer constants defined in `Modules/_ssl.c:7388-7398` with `ADD_INT_CONST("ECH_STATUS_BACKEND",...)` through `ADD_INT_CONST("ECH_STATUS_FAILED_ECH_BAD_NAME",...)`.

`_ssl._SSLSocket.get_ech_status` in `Modules/_ssl.c:2191-2192` returns a 3-tuple:

```c
int status=SSL_ech_get1_status(self->ssl,&inner_sni,&outer_sni);
PyObject *result=Py_BuildValue("(izz)",status,inner_sni,outer_sni);
```

i.e. `(status:int, inner_sni:str|None, outer_sni:str|None)`; `Modules/_ssl.c:2188-2189` returns `None` if `self->ssl==NULL`.

Division in `Lib/ssl.py`:

* `SSLObject.get_ech_status` at `Lib/ssl.py:1030-1032`: `ECHStatus(self._sslobj.get_ech_status()[0])` — index `0` only.
* `SSLObject.outer_server_hostname` at `Lib/ssl.py:866-870`: `return self._sslobj.get_ech_status()[2]` — index `2` only.
* `SSLSocket.get_ech_status` at `Lib/ssl.py:1484-1486`: same `[0]` wrapped in `ECHStatus`, but guarded by `if self._sslobj is not None`.
* `SSLSocket.outer_server_hostname` at `Lib/ssl.py:1168-1173`: same `[2]`, guarded by `if self._sslobj is not None`.

Index `1` (`inner_sni`) is never exposed by `ssl.py`; e.g. `Lib/test/test_ssl.py:2436-2437` asserts raw `_sslobj.get_ech_status()==(expected,None,None)` and `Lib/test/test_ssl.py:2508-2510` asserts `(...FAILED,'localhost','localhost')`.
