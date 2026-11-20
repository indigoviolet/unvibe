Any header value that has a long run of spaces or tabs not directly followed by a fold, and that also contains a `\r\n` elsewhere, would turn quadratic. A malicious or compromised server can send exactly that, so yes, it is attacker-controlled.

**The input.** Take a run of n blanks that is not the whitespace of an `obs-fold`. A fold elsewhere in the value is enough to get past the fast path. For example, `"a" + " " * n + "b"` on the first line, then `\r\n x` as a continuation line. [[diff:src-urllib3-connection.py:85-88]]

- The fast path only checks that `\r\n` appears somewhere in the value. It does not check where. One real fold anywhere sends the whole value, long run included, to the regex.
- Without the lookbehind, every start offset inside the run costs O(remaining blanks). The optional group takes the rest of the run and then gives blanks back one at a time, and `\r\n` fails each time. Summed over the run that is O(n²). [[diff:src-urllib3-connection.py:80-82]]
- With `(?<![ \t])`, only the first blank of a run can start the optional group. Every later offset fails at once, so the run costs O(n) in total.
- A run that ends right at `\r\n` followed by whitespace matches as a fold on the first try. That is why the trigger needs a run that is not part of a fold. A run followed by `\r\n` and then a non-blank (`"   \r\nb"`) is also slow without the lookbehind: `\r\n` matches after the greedy take, then the trailing `[ \t]+` fails, and the engine backs off blank by blank.

**Is it attacker-controlled?** The value comes from the response, so it is chosen by whoever runs the server. A client must treat response headers as untrusted input. The attacker needs nothing special. They send one blank-heavy header line and one fold, and the client spends CPU inside `re.sub`. This has the same effect as other regex-backtracking attacks: one response can stall the thread that is reading it.

**What bounds n.**

- `http.client` limits each header line to 65,536 bytes (`_MAXLINE`) and the number of header lines to 100 (`_MAXHEADERS`). I'm recalling these from the stdlib and have not checked them against the source for this question.
- A blank run cannot cross a `\r\n`, so n is at most about 64K per line. Without the lookbehind that is on the order of 2×10⁹ steps per line (n²/2), and an attacker could send up to 100 such lines. With the lookbehind it is about 64K steps per line.
- So the lookbehind is not cosmetic. It is what keeps `_normalize_header_value` cheap on hostile input. That is the invariant behind the code comment above the regex.

**What the tests miss.** Nothing tests this. Every case uses runs of a few blanks, so a pattern without the lookbehind would pass every current assertion. [[diff:test-test_connection.py:214-224]]

I did not run the pattern, so the step counts are analysis. The `_MAXLINE` bound is unverified.

### Follow-ups

- Which regex shape would give no quadratic behaviour even without a lookbehind? | ask: Could `_OBSOLETE_FOLD_RE` be written without a lookbehind, for example by anchoring on `\r\n` first, and still give the same results for every case in `test_normalize_header_value`?
- How would a size-sweep test for this look? | ask: Write a test for `_normalize_header_value` that fails if the lookbehind is removed, using a blank run that a linear pattern handles instantly and does not depend on wall-clock thresholds.

```json
{
  "anchor": {"quote": "would greedily consume the rest of the run", "blockId": "g-regex"},
  "contribute": {
    "open_questions": [
      "What are the actual per-line (_MAXLINE) and header-count (_MAXHEADERS) limits in http.client for the Python versions urllib3 supports, and do they bound the blank run that _OBSOLETE_FOLD_RE sees?"
    ]
  }
}
```