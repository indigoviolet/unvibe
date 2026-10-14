## The problem

HTTP/1.1 used to let a server continue a header value on the next line by starting that line with a space or tab. That's [[concept:obs-fold|obsolete line folding]]. Python's `http.client` keeps the folded value as it arrived, with the raw CRLF inside it, and urllib3 copied those values straight into its [[concept:http-headers|HTTPHeaderDict]]. A header such as `Set-Cookie` could therefore contain a hidden line break. [[desc:d-p1]] [[diff:conn:650-651]]

::: simple
Old servers sometimes split one header across two lines. Python keeps the line break inside the header's value, and urllib3 passed it along unchanged, so some header values contained hidden line breaks.
:::

::: deep
A parser leaking its input format. A fold is an encoding detail: one value written across lines. RFC 9112 requires a recipient to replace each fold with spaces before interpreting the value. Keeping the CRLF lets the wire format leak into the value itself, and every consumer then has to unfold it again, or carries the line break further.
:::

The line break isn't just untidy. Libraries that copy cookies from the response, such as Requests, read `http.client`'s own message object and can send the value back out with the raw CRLF in it. That can split one header into two on the next request: [[concept:header-injection|header injection]]. Issue #1362 tracked the original report. [[desc:d-p2]] [[desc:d-p1]]

::: simple
Worse, other libraries copy these values into the next request, and the hidden line break can turn one header into two.
:::

::: deep
A safety property. A header value must never contain CR or LF once it leaves the parser, because anything that writes it out again treats the line break as the end of the header. Normalizing at the one point where urllib3 turns the parsed response into its own types fixes every consumer at once, as long as the original message is fixed too.
:::

## The central change

urllib3 now unfolds header values right after `http.client` parses the response, as restated in [[card:problem#b1|the problem]]. A new helper replaces each fold (optional whitespace, CRLF, then at least one space or tab) with a single space. It updates both urllib3's `HTTPHeaderDict` and the original `HTTPMessage`, so code reading either one sees the same clean values. [[diff:conn:91-110]] [[diff:conn:650-651]]

::: simple
Right after a response arrives, urllib3 now turns every split header back into one line, in both copies of the headers.
:::

::: deep
Normalize the source, then derive. The fix rewrites the `HTTPMessage` in place (same object, same order, same duplicates) and builds `HTTPHeaderDict` from the same normalized list. Both views are equal by construction, and nothing downstream has to know folding ever existed.
:::

| Raw value | After |
|---|---|
| `before \t\r\n\t  after` | `before after` |
| `one\r\n two\t\r\n\tthree` | `one two three` |
| `one\r\n \r\n\tthree` | `one  three` (two folds give two spaces) |
| `ordinary\tvalue` | unchanged |

Finding: [[page:f-lf]]

The rule behind it: a parsed header value must never contain a line break. The pattern starts its optional whitespace match only at the beginning of a run of spaces, which keeps it [[concept:regex-performance|linear-time]] on long values, and a fast path skips any value without CRLF, which is almost all of them. [[diff:conn:80-88]]

::: simple
No header value should contain a line break after parsing. The code also stays fast, even for very long or unusual values.
:::

::: deep
Two properties are enforced together: a semantic one (no CR or LF in values) and a performance one (cost linear in input). The second matters because response headers are attacker-controlled input; a pattern that backtracks quadratically would turn a cleanup step into a [[concept:regex-performance|denial-of-service]] vector.
:::

```json
{
  "concepts": [
    {"slug": "obs-fold", "title": "Obsolete line folding (obs-fold)", "summary": "Servers must not fold; recipients replace each fold with spaces."},
    {"slug": "http-headers", "title": "HTTPHeaderDict and HTTPMessage", "summary": "Two copies of the headers; both are normalized."},
    {"slug": "header-injection", "title": "Header injection through raw line breaks", "summary": "A raw CRLF re-sent downstream can split one header into two."},
    {"slug": "regex-performance", "title": "Regex backtracking and linear-time patterns", "summary": "The lookbehind keeps the fold pattern linear-time."},
    {"slug": "ows-rws", "title": "OWS and RWS: whitespace in HTTP", "summary": "A fold is OWS CRLF RWS."},
    {"slug": "set-cookie", "title": "Why Set-Cookie lines stay separate", "summary": "Cookies contain commas, so lines are never joined."},
    {"slug": "requests-cookies", "title": "Requests reads the original HTTPMessage", "summary": "Requests builds its cookie jar from http.client's message."}
  ],
  "pendingCards": [
    {"id": "g-flow", "label": "Data flow: from the socket to HTTPHeaderDict", "why": "Follows a folded header from http.client through the new helpers to both header views."},
    {"id": "g-design", "label": "Design: why the original HTTPMessage is rewritten too", "why": "Two copies of the headers, who reads which, and how identity and order are kept."},
    {"id": "g-regex", "label": "The pattern: why the lookbehind matters", "why": "What each part of the regex matches, and the backtracking it avoids."},
    {"id": "g-check", "label": "Review checklist", "why": "Concrete things to verify, each linked to the line that answers it."}
  ],
  "cardIds": ["problem", "central"]
}
```
