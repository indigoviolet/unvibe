Order and duplicates are preserved. The helper works on `message.items()`, a list of pairs, deletes every header from the message, then re-adds the list in its original order [[diff:conn:102-108]]. The unit test checks this with two `Set-Cookie` lines separated by other headers [[diff:tconn:238-246]].

```json
{}
```
