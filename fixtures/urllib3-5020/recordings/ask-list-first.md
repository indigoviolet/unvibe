- The helper deletes every header from the message, then re-adds the saved pairs in their original order [[diff:conn:102-108]]
- The unit test checks the round trip with two `Set-Cookie` lines separated by other headers [[diff:tconn:238-246]]
- Nothing in the helper reorders a header or drops a duplicate

That packing list is the whole fix in three steps.

```json
{}
```
