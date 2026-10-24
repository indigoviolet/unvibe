# Unfold obsolete folded response headers

Addresses the original obs-fold response-header case discussed in #1362. Python's `http.client` preserves obsolete folded response header lines in `HTTPMessage` values. This change replaces each RFC 9112 `OWS CRLF RWS` sequence with a single space before urllib3 or downstream consumers interpret the value.

### The normalization

- keeps urllib3's `HTTPHeaderDict` and the original `HTTPMessage` synchronized, preventing cookie consumers such as Requests from re-emitting raw CRLF;
- preserves header names, ordering, duplicate fields, and parser state;
- uses a common-case fast path and a linear-time pattern for long field values.

### Tests

The socket regression covers the original folded `Set-Cookie`, duplicate cookies, every SP/HTAB combination around CRLF, mixed and repeated whitespace, multiple folds, and ordinary headers. Focused unit coverage also verifies adjacent folds and preservation of the original message's order, duplicates, payload, policy, and defects.

This intentionally does not address the separate whitespace-before-colon/header name validation scope discussed on #1362.

### Validation performed

- full local suite: 2,279 passed, 333 skipped, 4 xfailed;
- focused strict nox sessions on Python 3.12, 3.13, and 3.14;
- pyupgrade, Black, isort, and flake8;
- towncrier changelog validation;
- source distribution and wheel builds;
- end-to-end Requests cookie extraction and subsequent request serialization.

### Review checklist

1. confirm `HTTPMessage` no longer carries a raw `CRLF` after unfolding;
2. confirm `HTTPHeaderDict` matches the message on `Set-Cookie` pairs;
3. check duplicate headers keep their order and `defects` list;
4. check adjacent folds collapse to one `space`, not zero;
5. check mixed `SP` and `HTAB` runs around `CRLF` unfold cleanly;
6. check repeated folds produce one space per fold;
7. check ordinary header values pass through unchanged;
8. run the socket-level test with `fold-mixed-repeated` payloads;
9. run the unit suite for `test_connection.py` on Python 3.12;
10. run `towncrier` validation for the changelog fragment;
11. build the source distribution and the `wheel` artifacts;
12. verify Requests cookie extraction on the next request.
