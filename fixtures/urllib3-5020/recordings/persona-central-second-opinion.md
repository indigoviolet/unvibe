The central claim holds, but I checked it against the code line by line. urllib3 now unfolds every split header back into one line, in both copies of the headers. [[diff:conn:91-110]]

The rewrite deletes headers by name, so it scans the message each time — worth a second look at scale, though folded responses are rare enough that the cost stays theoretical. [[diff:conn:102]]

```json
{}
```
