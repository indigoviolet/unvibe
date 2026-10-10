## Concept stubs

- [[concept:obs-fold|Obsolete line folding]]: servers must not fold; recipients replace each fold with spaces. Mentioned in [[desc:d-intro]].
- [[concept:http-headers|HTTPHeaderDict and HTTPMessage]]: two copies of the headers, both normalized. Mentioned at [[diff:conn:650-651]].
- [[concept:header-injection|Header injection]]: a raw CRLF re-sent downstream can split one header into two. Mentioned in [[desc:d-sync]].
- [[concept:regex-performance|Regex backtracking]]: the lookbehind keeps the fold pattern linear-time. Mentioned at [[diff:conn:80-82]].
- [[concept:ows-rws|OWS and RWS]]: a fold is `OWS CRLF RWS`. Mentioned at [[diff:conn:82]].
- [[concept:set-cookie|Set-Cookie separation]]: cookie lines are never comma-joined. Mentioned at [[diff:tsock:124-127]].
- [[concept:requests-cookies|Requests reads the original message]]: Requests builds its cookie jar from `http.client`'s message. Mentioned at [[diff:tsock:139-146]].

```json
{
  "title": "Concept stubs",
  "concepts": [
    {"slug": "obs-fold", "title": "Obsolete line folding (obs-fold)", "summary": "Servers must not fold; recipients replace each fold with spaces."},
    {"slug": "http-headers", "title": "HTTPHeaderDict and HTTPMessage", "summary": "Two copies of the headers; both are normalized."},
    {"slug": "header-injection", "title": "Header injection through raw line breaks", "summary": "A raw CRLF re-sent downstream can split one header into two."},
    {"slug": "regex-performance", "title": "Regex backtracking and linear-time patterns", "summary": "The lookbehind keeps the fold pattern linear-time."},
    {"slug": "ows-rws", "title": "OWS and RWS: whitespace in HTTP", "summary": "A fold is OWS CRLF RWS."},
    {"slug": "set-cookie", "title": "Why Set-Cookie lines stay separate", "summary": "Cookies contain commas, so lines are never joined."},
    {"slug": "requests-cookies", "title": "Requests reads the original HTTPMessage", "summary": "Requests builds its cookie jar from http.client's message."}
  ]
}
```
