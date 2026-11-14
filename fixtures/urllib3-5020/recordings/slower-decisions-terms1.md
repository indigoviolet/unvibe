A decision here is a choice the change had to make between real alternatives, with the reason it went the way it did. Each one below names the alternative that was not taken and what would have broken had it been taken.

Normalizing in `getresponse` — and mutating the original message while at it — is the first decision. Cleaning only the `HTTPHeaderDict` copy would have left the raw CRLF in `msg`, which Requests reads for cookies, so the bug would have survived for exactly the consumers who reported it.

An invariant is a condition that holds after the change no matter the input: after `getresponse`, no header value in either copy contains a fold CRLF. Only the socket test checks both copies agree, which is why it is the one that pins the invariant.

A known uncertainty is a behavior the change leaves unspecified on purpose. Values with a bare CRLF — one not followed by whitespace — pass through unchanged, and nothing tests that case. Reading the code is enough to confirm it, because the pattern requires trailing whitespace to match at all.

Interfaces with reach are the public surfaces this change touches indirectly. The new helpers are private to `connection.py`, so the public surface is unchanged — but the visible effect lands on `HTTPResponse.headers` and on `_original_response.msg`, which Requests and others read.

```json
{"slower": {"cardId": "decisions"}}
```
