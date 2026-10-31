Requests builds its cookie jar from `response._original_response.msg`, the `http.client` message, not from urllib3's `r.headers`. That's why the PR rewrites the original message in place instead of only cleaning the dict it builds. The socket-level test checks both views and that the message is still the same object. [[diff:tsock:139-146]]

::: simple
Requests reads cookies from Python's own copy of the headers, so that copy has to be fixed too, not just urllib3's.
:::

```json
{
  "title": "Requests reads the original HTTPMessage"
}
```
