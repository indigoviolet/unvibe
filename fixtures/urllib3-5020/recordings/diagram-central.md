```d2
direction: right

gr: "getresponse" {link: "diff:src-urllib3-connection.py:650-651"}
nhvs: "_normalize_header_values" {link: "diff:src-urllib3-connection.py:91-110"}
nhv: "_normalize_header_value" {link: "diff:src-urllib3-connection.py:85-88"}
fast: "No \\r\\n:\nreturn as is" {link: "diff:src-urllib3-connection.py:86-87"}
re: "_OBSOLETE_FOLD_RE\nOWS CRLF RWS -> ' '" {link: "diff:src-urllib3-connection.py:80-82"}
sync: "Changed? delete and\nre-add on HTTPMessage" {link: "diff:src-urllib3-connection.py:102-108"}
hhd: "HTTPHeaderDict" {link: "diff:src-urllib3-connection.py:651"}

gr -> nhvs: "msg"
nhvs -> nhv: "each value"
nhv -> fast: "no CRLF"
nhv -> re: "has CRLF"
nhvs -> sync: "any change"
nhvs -> hhd: "(name, value) list" {link: "diff:src-urllib3-connection.py:110"}
sync.class: [ok]
```

Caption: How one parsed message is unfolded and then feeds both the original `HTTPMessage` and `HTTPHeaderDict`.

`getresponse` hands the parsed `HTTPMessage` to `_normalize_header_values`, which runs `_normalize_header_value` on every value. [[diff:src-urllib3-connection.py:650-651]] [[diff:src-urllib3-connection.py:96-97]]

A value without `\r\n` returns unchanged. A value with one goes through `_OBSOLETE_FOLD_RE`, which replaces each `OWS CRLF RWS` run with a single space. [[diff:src-urllib3-connection.py:86-88]] [[diff:src-urllib3-connection.py:82]]

If any value changed, the original `HTTPMessage` is rewritten in order by delete and re-add. The same normalized `(name, value)` list is then returned to build `HTTPHeaderDict`, so both views match. [[diff:src-urllib3-connection.py:102-110]] [[diff:src-urllib3-connection.py:651]]

```json
{
  "title": "Unfolding one message into two views"
}
```