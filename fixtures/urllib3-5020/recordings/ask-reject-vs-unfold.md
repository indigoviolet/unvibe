Not clearly. Rejecting would be stricter, but for a client it is the less compatible option, and RFC 9112 points to unfolding.

**What the RFC allows.** The description says a receiver must replace each `obs-fold` with spaces before interpreting the value. [[desc:d-p1]] From memory, I haven't re-read the RFC. RFC 9112 lets a proxy or gateway either reject the message with a 400 or unfold it. For a user agent reading a response, it only offers unfolding. urllib3 is the client side here, so rejecting would depart from the spec, not tighten it.

**What rejecting would buy.** It would remove a lenient-parsing case. Two components that disagree on how to read a fold are a classic source of request-smuggling and header-injection bugs. Refusing the response means no ambiguous value ever reaches a consumer, and it needs no in-place rewrite of the `HTTPMessage`.

**What it would cost.**
- The motivating case is a real server sending a folded `Set-Cookie`. The socket test reproduces it. [[diff:test-with_dummyserver-test_socketlevel.py:101-102]] Rejecting would turn that previously working response into an error. That is a breaking change for every urllib3 user who talks to such a server.
- It would need a new failure path in `getresponse` and a new exception type. The current change adds neither. It only swaps a call at the point where `HTTPHeaderDict` is built. [[diff:src-urllib3-connection.py:650-651]]
- By the time `getresponse` runs, `http.client` has already read the whole header block. Rejecting would throw away a complete response over a formatting quirk, and the connection would likely have to be closed.

**Why unfolding is safe enough here.** The danger this PR targets is a raw CRLF reaching a downstream consumer. After unfolding, `HTTPHeaderDict` and the original `HTTPMessage` both hold single-line values, so that hazard is gone. [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:102-108]] The remaining costs are small. The value is slightly rewritten, as in `___utmvbtouVBFmB=gZg XbNOjalT: ...`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] And urllib3 mutates a stdlib object it doesn't own.

**Rejection doesn't fix the open gap.** Rejecting would need the same detector as the current code, which only recognises `\r\n`. [[diff:src-urllib3-connection.py:86-87]] A bare-LF fold would slip past either approach, which is the point of the bare-LF finding.

**A middle path that is real.** A strict mode could reject folds when a caller asks for it, with unfolding as the default. Nothing in this repo or the description suggests the author considered it, so I can't say why it wasn't chosen. The choice to unfold looks inferred from the RFC and the #1362 report, not stated.

### Follow-ups

- Does RFC 9112 forbid a user agent from rejecting a folded response? | ask: What exactly does RFC 9112 section 5.2 say a user agent must or may do when it receives an obs-fold in a response, versus a proxy?
- What would an opt-in strict mode look like? | ask: How would a strict option that raises on obs-fold fit into `getresponse` and `_normalize_header_values`, and which exception would it use?

```json
{"anchor": {"quote": "An alternative is to normalize only the `HTTPHeaderDict`", "hostBlock": "card:decisions"}, "contribute": {"open_questions": ["Did the #1362 discussion consider rejecting obs-fold responses (or an opt-in strict mode) instead of unfolding? Not stated in the description."]}}
```