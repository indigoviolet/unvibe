```d2
direction: down

wire: "Folded bytes on socket\nSet-Cookie: a=1 \\r\\n two" {link: "diff:test-with_dummyserver-test_socketlevel.py:99-103"}
parse: "http.client parser\nraw CRLF stays in msg"
regex: "_OBSOLETE_FOLD_RE\nOWS CRLF RWS -> ' '" {link: "diff:src-urllib3-connection.py:80-82"}
one: "_normalize_header_value\none value" {link: "diff:src-urllib3-connection.py:85-88"}
all: "_normalize_header_values\nwhole message" {link: "diff:src-urllib3-connection.py:91-110"}
msg: "Original HTTPMessage\nrewritten in place" {link: "diff:src-urllib3-connection.py:102-108"}
gr: "getresponse" {link: "diff:src-urllib3-connection.py:650-651"}
hhd: "HTTPHeaderDict\nfrom normalized items" {link: "diff:src-urllib3-connection.py:651"}
inv: "Invariant: no consumer\nsees raw CRLF"

wire -> parse
parse -> gr: "msg"
gr -> all: "1 call" {link: "diff:src-urllib3-connection.py:650"}
all -> one: "each value" {link: "diff:src-urllib3-connection.py:97"}
one -> regex: "has CRLF"
all -> msg: "if changed"
all -> hhd: "items list" {link: "diff:src-urllib3-connection.py:110"}
msg -> inv
hhd -> inv
inv.class: [ok]
```
Caption: The three layers of the change, and the invariant they jointly protect.

The parser leaves the folded value in `msg`, and `getresponse` passes that message to `_normalize_header_values` [[diff:src-urllib3-connection.py:650-651]]. That function calls `_normalize_header_value` on each value, and the regex rewrites a value only if it contains a CRLF [[diff:src-urllib3-connection.py:85-97]]. The normalized items then go two ways. If any value changed, they are written back into the original `HTTPMessage`. They also become the source of `HTTPHeaderDict` [[diff:src-urllib3-connection.py:102-110]] [[diff:src-urllib3-connection.py:651]]. Both views are clean, so the invariant holds. The unit tests check the lower layers, and the socket test checks both views [[diff:test-test_connection.py:214-249]] [[diff:test-with_dummyserver-test_socketlevel.py:124-146]].

```json
{
  "title": "Three layers and the invariant they protect"
}
```