Not quite linear: the second loop is, but the first one is probably quadratic in the number of headers. With the header cap it should be too small to matter. I'm going from memory of the stdlib and haven't run it.

- **Re-add loop: linear.** `message[name] = value` appends. Under the `compat32` policy I don't expect it to count existing entries of that name, so each call should be constant-time. [[diff:src-urllib3-connection.py:107-108]]
- **Delete loop: likely quadratic.** As I recall, `email.message.Message.__delitem__` scans the whole internal header list for a case-insensitive name match and rebuilds the list. That makes each `del message[name]` cost about the current number of headers. With n distinct names, the total is roughly n²/2 comparisons. Duplicate names don't help, because the loop calls `del` once per item. The later deletes of an already-removed name still scan, but over a shorter list. [[diff:src-urllib3-connection.py:105-106]]
- **Why it doesn't matter in practice.** `http.client` caps a response at 100 headers (`_MAXHEADERS`), as I recall, and raises beyond that. The worst case is therefore about 5,000 string comparisons, and only for a response that contains a fold. That is negligible next to the network read.
- **Gating.** Ordinary responses never reach this code, because the rewrite runs only when `headers_changed` is true. The fast path also skips the regex for values without `\r\n`. [[diff:src-urllib3-connection.py:102]] [[diff:src-urllib3-connection.py:86-87]]
- **What would make it linear.** Deleting each distinct name once, or rebuilding the message in one pass, would do it. Neither is worth the added code at n ≤ 100. The cost of the current approach is that it depends on the header cap to stay cheap, and no test measures it.

The regex step is a separate cost: the lookbehind keeps it linear per value, so the quadratic part is only the `del` loop (see the `_OBSOLETE_FOLD_RE` lookbehind card). [[diff:src-urllib3-connection.py:80-82]]

### Follow-ups

- Does `http.client` really cap headers at 100? | ask: What limit does `http.client` place on the number of response headers, and where is it enforced?
- Could the delete loop skip repeated names? | ask: How would `_normalize_header_values` delete each distinct header name only once, and would that change the resulting order?

```json
{"anchor": {"quote": "delete-and-re-add pass over all headers", "hostBlock": "card:decisions"}, "contribute": {"open_questions": ["Is Message.__delitem__ a full scan of the header list per call, and does http.client cap responses at 100 headers (_MAXHEADERS)? Answer here is from memory, not run."]}}
```