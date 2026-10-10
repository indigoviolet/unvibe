Two levels. Unit tests cover the value helper (whitespace on both sides, multiple folds, two adjacent folds, a tab inside an ordinary value) [[diff:tconn:214-224]] and the message helper (order, duplicates, payload, defects, policy) [[diff:tconn:226-249]]. A socket-level test sends a real folded response through a pool and checks both header views [[diff:tsock:92-146]]. Nothing exercises bare LF folds or a very long value.

```json
{}
```
