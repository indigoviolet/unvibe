A plotline is one strand of the change followed from end to end — here there is exactly one, the unfolding of folded header values. It has three pieces, one per layer: the pattern plus the single-value helper, the message-level helper, and the call site that wires them in.

The tests follow the same layers, one group per layer. Unit tests cover the single value and the message: order, duplicates, payload, policy and defects. A socket-level test covers the whole path over a real connection, and a changelog fragment records the fix. [[diff:test-test_connection.py:214-249]] [[diff:test-with_dummyserver-test_socketlevel.py:92-146]] [[diff:changelog-1362.bugfix.rst:1-3]]

```json
{"slower": {"cardId": "buildup"}}
```
