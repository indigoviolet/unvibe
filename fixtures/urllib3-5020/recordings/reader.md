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

## The central idea

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

The pattern starts its optional whitespace match only at the beginning of a run of spaces, which keeps it [[concept:regex-performance|linear-time]] on long values, and a fast path skips any value without CRLF, which is almost all of them. [[diff:conn:80-88]]

::: simple
No header value should contain a line break after parsing. The code also stays fast, even for very long or unusual values.
:::

::: deep
Two properties are enforced together: a semantic one (no CR or LF in values) and a performance one (cost linear in input). The second matters because response headers are attacker-controlled input; a pattern that backtracks quadratically would turn a cleanup step into a [[concept:regex-performance|denial-of-service]] vector.
:::

## How it's built up

The change builds in two steps. First the unfolding itself: a helper replaces each fold with a single space, and both header views are built from the normalized values, so no consumer can see a raw line break again. [[diff:conn:91-110]] [[diff:conn:650-651]] Then the proof: unit and socket-level tests pin the before/after values, so the reader can check the rule — a parsed header value never contains a line break — against real responses instead of taking it on trust. [[diff:conn:650-651]]

::: simple
First the code learns to unfold folded headers everywhere it reads them. Then tests prove the unfolding gives the right values.
:::

::: deep
Normalize once, at the boundary, then prove the invariant at that boundary. Each later consumer inherits the property instead of re-establishing it, which is why the tests belong with the helper rather than with any one caller.
:::

## Decisions and questions

Three choices carry the change:

- First, normalize both views of the headers — urllib3's `HTTPHeaderDict` and the original `HTTPMessage` — instead of only the view urllib3 owns: code reading either one then sees the same clean values, at the cost of rewriting a message object urllib3 does not own (the reason is inferred from the two consumers the code serves; the description states the outcome, not the motive). [[diff:conn:650-651]] [[desc:d-p2]]
- Second, replace each fold with a single space rather than rejecting folded responses: folding is obsolete but still sent, and RFC 9112 requires recipients to unfold it, so rejection would break servers the standard says to tolerate (see [[concept:obs-fold|obsolete line folding]]).
- Third, guard the pattern so it stays [[concept:regex-performance|linear-time]] and skip values without CRLF entirely, instead of running one simple pattern over every header: headers are attacker-controlled, so the cleanup must never cost more than the parsing it follows. [[diff:conn:80-88]]

The invariant the change establishes: a parsed header value must never contain a line break. It is established where the response is turned into urllib3's types, relied on by every consumer that re-emits a value, and enforced by the unit and socket-level tests. [[diff:conn:91-110]] [[diff:conn:650-651]]

Known uncertainty: whether folded values that end in LF alone, without CRLF, occur in real responses cannot be settled from this code or description; traffic or server data showing such folds would settle it. [[diff:conn:80-88]]

No new public interface is added. The existing header views keep their shape: urllib3's `HTTPHeaderDict` and the original `HTTPMessage` hold the same names, order and duplicates, with folded values unfolded in both. [[diff:conn:650-651]] [[desc:d-p2]]

::: simple
Fix both copies of the headers, unfold instead of refusing folded responses, and keep the check cheap enough to run on every response.
:::

::: deep
Each choice trades a local simplicity for a global property: one normalization point (both views equal by construction), standards-mandated tolerance (unfold, never reject), and a cost bound on untrusted input (linear time, with a fast path for the common case).
:::

```json
{
  "pendingCards": [
    {"id": "g-flow", "label": "Data flow: from the socket to HTTPHeaderDict", "why": "Follows a folded header from http.client through the new helpers to both header views, so you can judge where a folded value could still slip through."},
    {"id": "g-design", "label": "Design: why the original HTTPMessage is rewritten too", "why": "Two copies of the headers, who reads which, and how identity and order are kept, so you can judge whether rewriting a message urllib3 does not own is the right call."},
    {"id": "g-regex", "label": "The pattern: why the lookbehind matters", "why": "What each part of the regex matches, and the backtracking it avoids, so you can judge the linear-time claim for long values."},
    {"id": "g-check", "label": "Review checklist", "why": "Concrete things to verify, each linked to the line that answers it, so you can judge what the tests do and do not cover."}
  ],
  "plotlines": [
    {"id": "unfold", "name": "Unfold folded values", "description": "Adds the unfolding itself, so every later step can assume no parsed header value contains a line break.", "hunks": ["h:src-urllib3-connection.py:fa60105d7fcbe8fe", "h:src-urllib3-connection.py:b355d2096d4d7f39"]},
    {"id": "unfold-tests", "name": "Prove the unfolding works", "description": "Adds unit and socket-level coverage, so the no-line-break rule can be checked against real responses.", "buildsOn": "unfold", "hunks": ["h:test-test_connection.py:6cfb09ec98cba6ba", "h:test-test_connection.py:92cf4ca541bdb0f2", "h:test-test_connection.py:b33779988cee5f8a", "h:test-with_dummyserver-test_socketlevel.py:949dda852e448b55"]}
  ],
  "cardIds": ["problem", "central", "buildup", "decisions"],
  "contribute": {"open_questions": ["Whether folded values that end in LF alone occur in real responses, and what traffic data would show it."]}
}
```
