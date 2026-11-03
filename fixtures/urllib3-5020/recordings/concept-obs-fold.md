`obs-fold` is the obsolete HTTP/1.1 header line folding syntax. A server splits one header value over several lines by putting optional whitespace and a CRLF before at least one space or tab on the next line. RFC 9112 writes this as OWS CRLF RWS. It tells receivers to replace each such sequence with one space before interpreting the value. [[desc:d-p1]]

In this change, `_OBSOLETE_FOLD_RE` is the code form of that grammar. The pattern is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`: an optional run of spaces or tabs, then `\r\n`, then one or more spaces or tabs. `_normalize_header_value` replaces each match with a single space. Values with no `\r\n` skip the regex. [[diff:src-urllib3-connection.py:80-88]]

## Why it matters here

Python's `http.client` leaves the fold in the `HTTPMessage` values, so `Set-Cookie: a=b\r\n    c=d` reaches urllib3 with the raw CRLF inside the value. Before the change, `getresponse` built `HTTPHeaderDict` straight from `httplib_response.msg.items()`. Both views therefore carried the CRLF. Downstream cookie consumers such as Requests could re-emit it when they serialised the next request. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p2]]

Two choices follow from the concept:

- **Where to unfold.** `_normalize_header_values` unfolds every value and returns the `(name, value)` items. `getresponse` builds `HTTPHeaderDict` from them. If any value changed, it also deletes and re-adds every header on the original `HTTPMessage`, so the message and `HTTPHeaderDict` stay identical. The alternative is to unfold only the `HTTPHeaderDict`. That is smaller, but a consumer reading the original message would still see the fold. The stated reason is the cookie-consumer case. The delete-and-re-add mechanism is the author's choice, and its reason is inferred. [[diff:src-urllib3-connection.py:91-110]] [[desc:d-p2]]
- **One space per fold.** The match consumes the whitespace before the CRLF, the CRLF, and the whitespace after it, so each fold becomes exactly one space. Two adjacent folds therefore give two spaces, not one merged space. The `(?<![ \t])` lookbehind makes the optional leading whitespace start only at the beginning of a run. The code comment says this avoids quadratic backtracking on long values. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:218-220]]

The scope is limited to `obs-fold` in response header values. Whitespace before the colon and header-name validation are explicitly out of scope. [[desc:d-p4]]

A review caveat: the pattern and the fast path recognise only `\r\n`. A fold written with a bare `\n` would not be matched, and the tests only send CRLF folds. [[diff:src-urllib3-connection.py:85-88]] [[diff:test-with_dummyserver-test_socketlevel.py:99-118]]

## Example

The socket-level test sends this fold-heavy header over a real socket:

```
Fold-Mixed-Repeated: one \t\r\n
\t  two\t \r\n
 \tthree\r\n
```

The parser leaves both folds in the value. After `getresponse`, both `r.headers["fold-mixed-repeated"]` and `r._original_response.msg["fold-mixed-repeated"]` are `"one two three"`. Each fold became one space, regardless of the mix of spaces and tabs around it. [[diff:test-with_dummyserver-test_socketlevel.py:112-114]] [[diff:test-with_dummyserver-test_socketlevel.py:132]] [[diff:test-with_dummyserver-test_socketlevel.py:146]]

The unit test makes the one-space-per-fold rule explicit. `"one\r\n \r\n\tthree"` becomes `"one  three"`, with two spaces. [[diff:test-test_connection.py:220]]

```d2
direction: right

wire: "Folded header\non the wire"
parsed: "HTTPMessage value\nstill has CRLF"
norm: "_normalize_header_values\nunfold each obs-fold" {
  link: "diff:src-urllib3-connection.py:91-110"
}
hhd: "HTTPHeaderDict\nno CRLF" {
  link: "diff:src-urllib3-connection.py:650-651"
}
msg: "HTTPMessage\nrewritten, no CRLF" {
  link: "diff:src-urllib3-connection.py:102-108"
}

wire -> parsed: "http.client"
parsed -> norm
norm -> hhd
norm -> msg
hhd.class: [ok]
msg.class: [ok]
```

Caption: Both header views are built from the same unfolded values.

### Follow-ups

- Does a bare-LF fold escape unfolding? | ask: If a server folds a header with a bare `\n` instead of `\r\n`, does `_normalize_header_value` leave it unchanged, and what would the value look like in `HTTPHeaderDict`?
- Why does each `obs-fold` become exactly one space? | ask: Why does `_OBSOLETE_FOLD_RE` consume the whitespace on both sides of the CRLF instead of replacing only the CRLF, and what would `"one\r\n \r\n\tthree"` give under that alternative?
- Where does unfolding sit relative to `HTTPHeaderDict` construction? | ask: In `getresponse`, why is `_normalize_header_values` called before building `HTTPHeaderDict`, and could anything read the raw message in between?

```json
{"title": "obs-fold"}
```