## The problem

Obsolete line folding (`obs-fold`) is a CRLF followed by spaces or tabs inside a header field value. In HTTP/1.1, CRLF is the delimiter that frames the message, so a value should never contain one after parsing. Python's `http.client` parses with the `email` package, which keeps the continuation lines inside the `HTTPMessage` value. That is my recollection of `http.client`, not something this repo shows. A folded `Set-Cookie` therefore arrived as one string with the CRLF and its whitespace still embedded. Before the change, `getresponse` built the `HTTPHeaderDict` straight from `httplib_response.msg.items()` and did no normalization. Both urllib3's view and the original message carried the framing characters as data. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

The mismatch matters for two reasons.

- RFC 9112 says a recipient of an obs-fold must replace each one with one or more spaces before interpreting the value. This is the rule that restores the invariant "a field value is one logical line". It is inferred from the description's RFC 9112 reference, and the replacement of each `OWS CRLF RWS` sequence with a single space follows from it. If recipients do not normalize, the same bytes can mean different things to different layers. [[desc:d-p1]]
- Consumers such as Requests read cookies from the original message, not from `HTTPHeaderDict`. If a raw CRLF survives there, the next request is serialized with that CRLF in the middle of a header line. The peer then sees a different header structure from the one the server sent. Fixing only the urllib3 copy would not help these consumers, so the original message has to be fixed too. [[desc:d-p2]]

The change covers only the folded-value case from #1362. Whitespace before the colon and header-name validation are separate problems about the shape of the name, not the content of the value, so they are out of scope. [[desc:d-p4]]

::: principle
A parser should hand later layers values that cannot contain the delimiters they will later use to frame the message. If it hands over raw delimiters, every consumer has to defend itself, and any one that does not can turn data into structure when it re-serializes. Normalizing once at the boundary where the bytes become headers means every reader of that boundary sees the same safe value.
:::

```json
{"depth": {"level": "deep", "cardId": "problem"}}
```