The tests mostly feed the pattern inputs it must change. They almost never feed it inputs it must leave alone, so over-eager rewriting would go unnoticed.

**What "not a well-formed `obs-fold`" means.** `_OBSOLETE_FOLD_RE` only matches a CRLF followed by at least one space or tab. The trailing `[ \t]+` is mandatory. [[diff:src-urllib3-connection.py:80-82]] Anything else that looks like a line break is not a fold, and the rule should return it untouched. That includes `"a\r\nb"`, a lone `\n`, and a lone `\r`.

**What the tests feed it.** The four `test_normalize_header_value` cases are:
- `"ordinary\tvalue"`, which has no CRLF at all.
- Three cases that each have whitespace after the CRLF. [[diff:test-test_connection.py:217-220]]

The socket test's folded headers and its `Ordinary: one\t two` header follow the same split. [[diff:test-with_dummyserver-test_socketlevel.py:99-117]] Only the ordinary value is "not a fold", and it never reaches the regex, because the `"\r\n" not in value` check returns early. [[diff:src-urllib3-connection.py:85-88]] No test uses a value that passes that check and then fails the pattern.

**Why this matters.** The code is wrong if it misses a fold. It is also wrong if it changes something that is not a fold. Tests that only assert outputs on folded inputs catch the first error and not the second. If the trailing `[ \t]+` became `[ \t]*`, every current expected string would stay the same. `"a\r\nb"` would then become `"a b"`, which merges two field lines into one value. The guarantee that a CRLF without following whitespace stays intact is the limit of what the change rewrites. Nothing pins it.

**What is not known.** I did not run `http.client`, so I don't know whether a real socket response can hand `_normalize_header_value` such a value. The helper accepts any `str`, so a direct unit test on `"a\r\nb"` would be cheap and would not depend on that.

### Follow-ups

- What would a minimal refusal test look like? | ask: Which extra cases should be added to `test_normalize_header_value` so that loosening the trailing `[ \t]+` to `[ \t]*` fails a test?
- Can `http.client` produce a value with a CRLF not followed by whitespace? | ask: Can a header value containing `\r\n` without following SP/HTAB reach `_normalize_header_value` from a real socket response?

```json
{"anchor": {"quote": "thin on inputs that are not a well-formed obs-fold", "blockId": "card:g-tests"}, "contribute": {"open_questions": ["Can a header value with a CRLF not followed by SP/HTAB reach _normalize_header_value from a real http.client response?"]}}
```