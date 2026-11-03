```d2
direction: right

rule: "Layer 1\n_normalize_header_value" {link: "diff:src-urllib3-connection.py:85-88"}
re: "_OBSOLETE_FOLD_RE\nfold -> one space" {link: "diff:src-urllib3-connection.py:80-82"}
msgl: "Layer 2\n_normalize_header_values" {link: "diff:src-urllib3-connection.py:91-110"}
msg: "same HTTPMessage\nrewritten if changed" {link: "diff:src-urllib3-connection.py:102-108"}
items: "header_items\none cleaned list" {link: "diff:src-urllib3-connection.py:110"}
call: "Layer 3\ngetresponse" {link: "diff:src-urllib3-connection.py:650-651"}
hhd: "HTTPHeaderDict\nbuilt from items" {link: "diff:src-urllib3-connection.py:651"}

call -> msgl: message {link: "diff:src-urllib3-connection.py:650"}
msgl -> rule: each value {link: "diff:src-urllib3-connection.py:97"}
rule -> re: only if CRLF {link: "diff:src-urllib3-connection.py:86-88"}
re -> items: clean value
msgl -> msg: if changed {link: "diff:src-urllib3-connection.py:102-108"}
msgl -> items: returns {link: "diff:src-urllib3-connection.py:110"}
items -> hhd: same data
msg.class: [ok]
hhd.class: [ok]
```
Caption: Each layer owns one guarantee, and the call site joins them.

`getresponse` hands the `HTTPMessage` to Layer 2, `_normalize_header_values`, which is the first step in the order that matters. It must run before the dict is built. [[diff:src-urllib3-connection.py:650-651]]

Layer 2 calls Layer 1, `_normalize_header_value`, on each value. Layer 1 knows only strings. It returns at once when there is no `\r\n`, and otherwise `_OBSOLETE_FOLD_RE` turns each fold into one space. [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:80-82]]

Layer 2 gathers the results into one `header_items` list. If any value changed, it rewrites the same `HTTPMessage` from that list, and it returns the list. `HTTPHeaderDict` is then built from the list that was just written back, so the two copies cannot drift apart. [[diff:src-urllib3-connection.py:102-110]] [[diff:src-urllib3-connection.py:651]]

```json
{"degraded": null}
```