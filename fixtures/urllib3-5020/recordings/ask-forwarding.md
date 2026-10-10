RFC 9112 asks a recipient to unfold before interpreting or forwarding. urllib3 isn't a proxy, but its callers might forward headers, so cleaning them at parse time also covers that case. [[desc:d-p2]]

```json
{}
```
