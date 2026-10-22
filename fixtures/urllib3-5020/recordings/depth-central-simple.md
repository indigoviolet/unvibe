Right after a response arrives, urllib3 now turns every split header back into one line, in both copies of the headers. [[diff:conn:91-110]] [[diff:conn:650-651]]

No header value should contain a line break after parsing. The code also stays fast, even for very long or unusual values. [[diff:conn:80-88]]

```json
{
  "title": "The central idea",
  "depth": {"level": "simple", "cardId": "central"}
}
```
