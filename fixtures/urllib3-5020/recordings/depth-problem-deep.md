A parser leaking its input format. A fold is an encoding detail: one value written across lines. RFC 9112 requires a recipient to replace each fold with spaces before interpreting the value. Keeping the CRLF lets the wire format leak into the value itself, and every consumer then has to unfold it again, or carries the line break further. [[desc:d-intro]] [[diff:conn:650-651]]

A safety property. A header value must never contain CR or LF once it leaves the parser, because anything that writes it out again treats the line break as the end of the header. Normalizing at the one point where urllib3 turns the parsed response into its own types fixes every consumer at once, as long as the original message is fixed too. [[desc:d-sync]] [[desc:d-intro]]

::: underlying-principle
Convert wire encodings into one canonical value at the boundary where data enters, so nothing downstream has to know how the bytes were laid out, or can be tricked by it.
:::

```json
{
  "title": "The problem",
  "depth": {"level": "deep", "cardId": "problem"}
}
```
