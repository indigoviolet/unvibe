```d2
direction: right

getresp: "getresponse\nhttplib_response.msg" {link: "diff:src-urllib3-connection.py:647-651"}
norm: "_normalize_header_values" {link: "diff:src-urllib3-connection.py:91-110"}
one: "_normalize_header_value\nper value" {link: "diff:src-urllib3-connection.py:85-88"}
fast: "no \\r\\n?\nreturn as is" {link: "diff:src-urllib3-connection.py:86-87"}
re: "_OBSOLETE_FOLD_RE.sub\nfold -> one space" {link: "diff:src-urllib3-connection.py:80-88"}
items: "header_items\none cleaned list" {link: "diff:src-urllib3-connection.py:94-100"}
msg: "same HTTPMessage\ndel all, re-add in order" {link: "diff:src-urllib3-connection.py:102-108"}
hhd: "HTTPHeaderDict\nbuilt from items" {link: "diff:src-urllib3-connection.py:650-651"}

getresp -> norm: message
norm -> one: each value
one -> fast: no CRLF
one -> re: has CRLF
fast -> items
re -> items
items -> msg: only if changed
items -> hhd: returned
msg.class: [ok]
hhd.class: [ok]
```

Caption: One cleaned list feeds both the original message and `HTTPHeaderDict`.

Each header value goes through `_normalize_header_value`. Values with no `\r\n` return untouched. Values with a fold go through `_OBSOLETE_FOLD_RE`, which turns each fold into one space [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:80-82]].

The cleaned pairs are collected in `header_items`. If any value changed, the same `HTTPMessage` has every name deleted and then re-added in sequence, which keeps order, duplicates, and object identity [[diff:src-urllib3-connection.py:94-108]].

The function returns that same list, and `getresponse` builds `HTTPHeaderDict` from it. Both copies therefore come from one source and cannot disagree [[diff:src-urllib3-connection.py:110]] [[diff:src-urllib3-connection.py:650-651]].

```json
{"contribute": {"facts": []}}
```