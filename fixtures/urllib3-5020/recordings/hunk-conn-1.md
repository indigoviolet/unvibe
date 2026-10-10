`getresponse()` now builds `HTTPHeaderDict` from the normalized header list instead of the raw `HTTPMessage` items. This is the only call site. [[diff:conn:650-651]]

```json
{
  "hunk": {
    "summary": "`getresponse()` now builds `HTTPHeaderDict` from the normalized header list instead of the raw `HTTPMessage` items. This is the only call site.",
    "hiddenReason": null
  }
}
```
