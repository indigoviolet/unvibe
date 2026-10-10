HTTP separates headers with CRLF. If a header value itself contains CRLF and some code later writes that value back out, for example a cookie jar sending a stored cookie on the next request, the line break ends the header early and whatever follows becomes a new header. That's header injection. Here the risk is that a folded `Set-Cookie` could be re-sent with a raw CRLF inside it. [[desc:d-p2]]

::: simple
A hidden line break inside a header can split one header into two when the value is sent again. Removing line breaks from values prevents that.
:::

::: deep
The invariant is simple: no CR or LF in a field value after parsing. Code that serializes headers trusts that invariant, so it must hold at the boundary where external bytes become values. Enforcing it once in `getresponse()` protects every downstream serializer, as long as the enforcement covers every line terminator the parser accepts.
:::

::: example
```
# stored cookie value with a raw fold:
"session=abc \r\n X-Injected: 1"
# re-sent as a request header:
Cookie: session=abc
 X-Injected: 1        <- a server may read this as a new header
```
:::

```json
{
  "title": "Header injection",
  "anchor": {"quote": "split one header into two on the next request", "host": "card:problem#b2"}
}
```
