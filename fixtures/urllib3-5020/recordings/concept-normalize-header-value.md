## _normalize_header_value

`_normalize_header_value` is the single-value helper in `connection.py`. It takes one header value string and returns it with each `obs-fold` replaced by one space. If the value has no `"\r\n"`, it returns the value unchanged and never runs the regex. Otherwise it calls `_OBSOLETE_FOLD_RE.sub(" ", value)`. [[diff:src-urllib3-connection.py:85-88]]

The pattern is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It matches optional whitespace before the CRLF, the CRLF, and then at least one SP or HTAB. The whole match becomes a single space, which is the RFC 9112 rule the description cites. [[diff:src-urllib3-connection.py:80-82]] [[desc:d-p1]]

### Why it matters here

This is the one place where the fold rule is defined. `_normalize_header_values` calls it on every `HTTPMessage` item, and `getresponse` uses the results to build `HTTPHeaderDict`. The same rule therefore applies to both the dict and the original message. [[diff:src-urllib3-connection.py:94-100]] [[diff:src-urllib3-connection.py:647-651]]

Splitting it into its own function has two effects:

- **The fast path.** Most header values have no CRLF, so they skip the regex. The description names this as a "common-case fast path". [[desc:d-p2]]
- **Direct tests.** The rule can be tested on plain strings, with no message or socket. `test_normalize_header_value` does this with four cases. [[diff:test-test_connection.py:214-224]]

One alternative is to inline the substitution in `_normalize_header_values`. Another is to split on `\r\n` and strip each piece. The description does not say why a separate regex helper was chosen, so the reason is inferred. The helper form keeps the rule in one `sub` call and makes it testable by itself.

The helper only handles `"\r\n"` followed by SP or HTAB. A CRLF not followed by whitespace passes through unchanged, and no test covers that. A fold ending in a bare `\n` is not matched either, because the fast-path check also looks for `"\r\n"`. The review has a finding on that bare-LF case. [[diff:src-urllib3-connection.py:86-88]] [[page:f-critic-2]]

### Example

These cases come from the unit test. [[diff:test-test_connection.py:217-220]]

| Input | Output | What happens |
|---|---|---|
| `"ordinary\tvalue"` | `"ordinary\tvalue"` | There is no CRLF, so it returns early. The inner tab is kept. |
| `"before \t\r\n\t  after"` | `"before after"` | The whitespace on both sides of the CRLF is absorbed into one space. |
| `"one\r\n two\t\r\n\tthree"` | `"one two three"` | Each of the two folds becomes one space. |
| `"one\r\n \r\n\tthree"` | `"one  three"` | The lookbehind stops the second fold from absorbing the space left by the first, so two spaces remain. |

The last row differs from the description's claim that adjacent folds collapse to one space. [[page:f-critic]]

### Follow-ups

- Should the fast-path check and the regex cover a bare `\n` as well as `\r\n`? | ask: What would change in `_normalize_header_value` and its tests if the fast path and `_OBSOLETE_FOLD_RE` accepted `\r?\n`?
- Is the early return actually needed for performance? | ask: Would `_normalize_header_value` be measurably slower without the `"\r\n" not in value` check, given the regex only does work when a CRLF is present?
- Which inputs reach `_normalize_header_value` from a real socket? | ask: Can `http.client` give `_normalize_header_value` a value with a CRLF not followed by SP or HTAB, or is that only reachable by calling the helper directly?

```json
{"title": "_normalize_header_value"}
```