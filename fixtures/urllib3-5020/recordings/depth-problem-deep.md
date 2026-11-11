## The problem

HTTP/1.1 servers may still send obsolete folded header lines (`obs-fold`), where a value continues on the next line after CRLF plus whitespace. Python's `http.client` keeps those raw CRLFs inside the `HTTPMessage` values. urllib3 then copied them unchanged into `HTTPHeaderDict`, so a header such as a folded `Set-Cookie` reached consumers with embedded `\r\n` in it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

::: simple
Some HTTP servers still split one header value across several lines. This old style is called `obs-fold`. The next line starts with a space or tab. Python's `http.client` keeps the line break (`\r\n`) inside the stored value. urllib3 then copied that value unchanged into `HTTPHeaderDict`. A folded `Set-Cookie` header therefore reached other code with a `\r\n` inside it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]
:::

::: deep
In HTTP/1.x, CRLF is the framing delimiter. It ends one field line and starts the next. A message is only unambiguous if a parsed field value contains no framing bytes. If a value did, anyone who writes it back out would produce something a reader parses as a different message structure. `obs-fold` is the one historical exception. A sender may break a value across lines, and RFC 9112 requires the recipient to replace each fold (CRLF plus SP/HTAB) with SP before interpreting or forwarding the value. That rule turns a wire-level quirk into a clean internal invariant: after parsing, a value is a single logical line. The code lacked this step.

`http.client` keeps the continuation with its line break still inside the value. It "preserves" the fold, as the description says. The parser is faithful to the bytes. What is missing is a step between parsing and use that enforces the invariant. urllib3 copied `msg.items()` straight into `HTTPHeaderDict`, so the violation spread unchanged.

The invariant has to be enforced at the first place that holds the data. Otherwise every consumer must defend against CRLF itself, and the first one that does not will re-emit the value. The CRLF is then read as a line break in whatever it writes. That is how a folded `Set-Cookie` could cause trouble downstream. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]
:::

Before the change, `getresponse` built the headers with `HTTPHeaderDict(httplib_response.msg.items())`, with no cleanup. The original `HTTPMessage` stayed on the response as `_original_response.msg`. Cookie consumers such as Requests read that message directly, and they could re-emit raw CRLF on later requests. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]

::: simple
Before this change, `getresponse` built the headers with `HTTPHeaderDict(httplib_response.msg.items())`. It did no cleanup. Python's original header object, `HTTPMessage`, also stayed on the response as `_original_response.msg`. Cookie libraries such as Requests read that object directly. They could send the raw `\r\n` again on later requests. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]
:::

::: deep
After `getresponse`, the same header data lives in two places. One is the `HTTPHeaderDict` that urllib3 builds. The other is the `HTTPMessage` that `http.client` built, still reachable as `_original_response.msg`. The dict is a snapshot taken from `msg.items()`. The two are equal only at the moment of copying, and neither is derived from the other afterwards. Nothing keeps them in step.

Consumers choose between the copies independently. The description says cookie consumers such as Requests read the `HTTPMessage`, not urllib3's dict. Two consequences follow:

- A fix that cleans only one copy leaves the other with the fold. The two then disagree, and what a caller sees depends on which attribute it reads.
- With no cleanup at all, both copies carry the raw CRLF, and the Requests path can re-emit it on later requests.

So the real requirement is stronger than "clean `HTTPHeaderDict`". The no-fold invariant must hold in every copy a consumer can reach, and the copies must agree with each other. If the fix cleaned a copy, or built a new object, that existing holders do not see, the invariant would fail for exactly those holders. [[desc:d-p2]] [[diff:src-urllib3-connection.py:647-651]]
:::

The reported case is #1362. Whitespace before the colon and header-name validation are a separate issue and are not part of this change. [[desc:d-p4]]

::: simple
The bug report is #1362. A different problem is not part of this change: spaces before the colon and header-name checks. [[desc:d-p4]]
:::

::: deep
The change is limited to the field value, the part after the colon. Whitespace before the colon and header-name validation concern the field name and the shape of the field line. These are different syntax rules, with different fixes and different risks. Rejecting or rewriting a malformed name changes what a response means, while unfolding a value only restores the single-line form the RFC defines. The author leaves the name-side questions to the other thread on #1362.

Keeping them out means the change enforces one rule only: no fold survives in a value. It can then be judged against RFC 9112's `obs-fold` handling alone, with no interaction between the two rules to reason about. [[desc:d-p4]]
:::

::: principle
Enforce an input invariant once, at the boundary where the data enters your system, and in every copy that leaves it. Otherwise each downstream consumer must re-defend the invariant, and any consumer that forgets becomes the bug.
:::

```json
{"depth": {"level": "deep", "cardId": "problem"}}
```