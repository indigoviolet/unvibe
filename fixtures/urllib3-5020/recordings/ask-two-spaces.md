Yes. RFC 9112 allows replacing each fold with one or more spaces, and the helper replaces each fold with exactly one. `"one\r\n \r\n\tthree"` contains two folds back to back, so it becomes two spaces [[diff:tconn:220]]. Collapsing them further would change whitespace the server actually sent.

```json
{}
```
