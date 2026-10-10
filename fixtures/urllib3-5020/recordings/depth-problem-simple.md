Old servers sometimes split one header across two lines. Python keeps the line break inside the header's value, and urllib3 passed it along unchanged, so some header values contained hidden line breaks. [[desc:d-p1]] [[diff:conn:650-651]]

Worse, other libraries copy these values into the next request, and the hidden line break can turn one header into two. [[desc:d-p2]] [[desc:d-p1]]

```json
{
  "title": "The problem",
  "depth": {"level": "simple", "cardId": "problem"}
}
```
