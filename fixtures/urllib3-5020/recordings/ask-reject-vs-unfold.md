Rejecting would be safer only against a threat that doesn't apply to a client reading a response, and it would stop the client from reading responses that real servers send. Unfolding is also what the spec requires of this role.

**What the spec allows.** From my knowledge of RFC 9112 (not in the base, and not checked here): a server or proxy may either reject or unfold an `obs-fold`. A user agent that receives one in a response must replace it with one or more spaces before interpreting the value. urllib3 is the user agent here, so rejection is not the option the RFC gives it. This is also why the change follows the unfolding rule. [[desc:d-p1]]

**Where rejection is safer.** The classic argument is request smuggling. A server or proxy that guesses differently from its neighbour about where a field ends can be exploited. That is why rejection is allowed on that side. This change only reads responses. The harm it targets is a consumer re-emitting a raw CRLF from a stored value. Unfolding removes that harm, and rejecting would too. Rejecting adds no protection that unfolding lacks for this invariant. The invariant is that after parsing, no copy a consumer can reach carries a fold. [[diff:src-urllib3-connection.py:80-88]]

**What rejection would cost.**
- The trigger in this change is a real-looking folded `Set-Cookie`, which the socket test reproduces byte for byte. A rejecting client could not read any response from such a server, not even the body. Unfolding keeps the response usable. [[diff:test-with_dummyserver-test_socketlevel.py:99-103]]
- The rewrite is cheap and local. `getresponse` normalizes the message and builds `HTTPHeaderDict` from the result. Rejection would need a new error path and a decision about which exception to raise, and I did not look at how urllib3 handles other header defects. [[diff:src-urllib3-connection.py:647-651]]
- The unfolding is lossless for any consumer that treats a value as one logical line. A rejected response gives the caller nothing.

**Where rejection could still be a reasonable option.** A strict mode that raises on any `obs-fold` could be useful in a security-sensitive client. It would have to be opt-in, because on by default it would break the use case the PR targets. The change doesn't offer that. It also doesn't say whether the author considered it. The description doesn't discuss rejection, so I can't give a stated reason for not choosing it. [[desc:d-p1]]

**What this change does not cover.** It handles only `\r\n` folds. A fold spelled with a bare `\n` still passes through untouched, as the bare-LF finding describes. Rejecting any value with a stray line break would close that gap too. That is a different policy from the one this change implements, and widening the pattern is the cheaper way to close it. [[diff:src-urllib3-connection.py:86-88]]

### Follow-ups

- Does urllib3 already have an error for header defects that a strict mode could reuse? | ask: Which existing urllib3 exception or `defects` check handles malformed response headers, and could it be used to reject an `obs-fold` instead of unfolding it?
- Would an opt-in strict mode be a small change? | ask: What would an opt-in setting that raises on `obs-fold` need in `_normalize_header_values` and `getresponse`, and which tests would it need?

```json
{
  "anchor": {"quote": "A fix that cleaned only HTTPHeaderDict would leave the raw CRLF in msg", "blockId": "card:g-alt"},
  "contribute": {
    "open_questions": ["Does urllib3 have an existing path that raises on HTTPMessage defects, and would an obs-fold rejection mode fit it?"]
  }
}
```