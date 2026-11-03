The changelog fragment is the one-file record of the fix for the release notes. It doesn't change behaviour, and no test depends on it. [[diff:changelog-1362.bugfix.rst:1-3]]

The fragment is named `1362.bugfix.rst`. The number ties it to issue #1362, and `bugfix` tells towncrier which section of the release notes to put it in. Its text says that folded header lines (`obs-fold`) are now replaced with spaces per RFC 9112, so values such as `Set-Cookie` no longer carry a raw CRLF. [[diff:changelog-1362.bugfix.rst:1-3]]

The description lists towncrier validation of this fragment among its checks. I haven't run it. [[desc:d-p5]]

The fragment is not one of the three layers (the single-value rule, the whole-message rewrite, and the `getresponse` call). It sits beside them as documentation. It does not protect the invariant that no consumer sees a raw CRLF. It only tells users the invariant now holds. [[diff:src-urllib3-connection.py:80-110]] [[diff:src-urllib3-connection.py:650-651]]

The fragment states the fix more broadly than the code delivers. It says folded lines "no longer" leave raw CRLF sequences in values. The detector only recognises `\r\n`, so the bare-LF finding applies to this wording too. [[diff:src-urllib3-connection.py:86-87]]

### Follow-ups

- Does the changelog wording match what the code handles? | ask: The changelog says raw CRLF sequences no longer appear in header values. Is that fully true given that `_normalize_header_value` only checks for `\r\n`?
- Where does towncrier pick up this fragment? | ask: How does the `1362.bugfix.rst` filename map to a release-notes section, and where is that configured in the repo?

```json
{"anchor": {"quote": "A changelog fragment records the fix", "block": "card:buildup"}}
```