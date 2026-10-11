RFC 9112 lets a recipient either reject a message with folded headers or replace each fold with spaces. Rejecting is stricter but breaks the rare legacy servers that still fold, and urllib3 has generally favoured compatibility. Unfolding is safe as long as it covers every line ending the parser accepts, which is the gap in the [[page:f-lf|bare-LF finding]].

```json
{}
```
