HTTP/1.1 originally let a server continue a header value on the next line, as long as that line started with a space or tab. That's line folding. RFC 9112 now calls it `obs-fold` (obsolete folding): servers must not send it, and a client that receives it must replace each fold with one or more spaces before using the value. Python's `http.client` doesn't do that; it keeps the CRLF and the leading whitespace inside the value. [[desc:d-intro]] [[diff:conn:80-82]]

::: simple
Some servers split one long header across two lines, starting the second line with spaces. The modern rule is: treat that split as a single space. Python keeps the line break instead, so urllib3 has to clean it up.
:::

::: deep
A fold is a property of the encoding, not of the value: the same value can be sent folded or not. A parser that keeps the fold leaks its input format into the semantic value, so every consumer must either re-implement unfolding or carry a raw line break further. RFC 9112 section 5.2 resolves it at the recipient, before interpretation or forwarding.
:::

::: example
```
Set-Cookie: a=1; path=/ <CR><LF>
    Max-Age=900<CR><LF>

# http.client keeps:   'a=1; path=/ \r\n    Max-Age=900'
# urllib3 now returns: 'a=1; path=/ Max-Age=900'
```
:::

RFC 9112 allows a recipient to reject a folded message or unfold it. urllib3 unfolds, using one space per fold. Whitespace is one of the [[concept:ows-rws|OWS and RWS]] rules.

```json
{
  "title": "Obsolete line folding (obs-fold)",
  "anchor": {"quote": "obsolete folded response header", "host": "desc:d-intro"}
}
```
