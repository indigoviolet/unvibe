A response's headers exist twice: urllib3's `HTTPHeaderDict` and `http.client`'s `HTTPMessage`. Requests reads cookies from the second, so cleaning only the first would leave the raw CRLF where it does harm. [[desc:d-p2]]

The helper therefore rewrites the original message in place. It keeps the object's identity (the socket test checks `headers is msg`), its `defects` and `policy`, its payload, and the order of every header, including duplicate `Set-Cookie` lines. [[diff:tconn:226-249]] [[diff:tsock:141]]

The alternative, building a new message, would break anything already holding a reference to the old one. Normalizing the list once and deriving both views from it makes them equal by construction.

### Follow-ups

- Is mutating the message in place safe? | ask: identity
- What does this cost per response? | ask: cost

```json
{
  "title": "Design: why the original HTTPMessage is rewritten too",
  "cardId": "g-design"
}
```
