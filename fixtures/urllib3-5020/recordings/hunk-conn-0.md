Adds `_OBSOLETE_FOLD_RE` and two helpers. `_normalize_header_value` turns each fold into one space, with a fast path for values without CRLF. `_normalize_header_values` applies it to every header and, if anything changed, rewrites the original `HTTPMessage` in place, keeping order and duplicates. [[diff:conn:80-88]]

```json
{
  "hunk": {
    "summary": "Adds `_OBSOLETE_FOLD_RE` and two helpers. `_normalize_header_value` turns each fold into one space, with a fast path for values without CRLF. `_normalize_header_values` applies it to every header and, if anything changed, rewrites the original `HTTPMessage` in place, keeping order and duplicates.",
    "hiddenReason": null
  }
}
```
