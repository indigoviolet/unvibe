Response headers now pass through `_normalize_header_values` before building `HTTPHeaderDict`, instead of using the raw `msg.items()`.

```json
{"hunk": {"summary": "Response headers now pass through `_normalize_header_values` before building `HTTPHeaderDict`, instead of using raw `msg.items()`.", "hiddenReason": null, "score": "substantive"}}
```