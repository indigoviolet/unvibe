Without the lookbehind, the input that goes quadratic is a long run of spaces or tabs that is **not** directly followed by `\r\n`, inside a value that contains a fold somewhere else. Example: `"a" + " " * n + "b\r\n c"`. A malicious server can send this, but the size of the run is capped by `http.client`'s line limit.

**Why that input is slow**
- The fast path only checks for `"\r\n"` anywhere in the value. The trailing fold lets this value through to the regex. [[diff:src-urllib3-connection.py:86-88]]
- `re.sub` tries a match at every position. Without the lookbehind, the optional `[ \t]+` can start at every position inside the run.
- Each attempt takes the rest of the run greedily, fails to find `\r`, and gives back one character at a time. The cost is about n−i steps for start position i, so about n²/2 in total.
- With `(?<![ \t])`, the optional group can only start at the first character of a run. Every later start position fails the lookbehind immediately. That leaves one O(n) attempt per run. [[diff:src-urllib3-connection.py:80-82]]

**Where the long run comes from**
- The run has to be interior to the value. The parser strips whitespace after the colon, so `Name: <spaces>x\r\n y` doesn't work, but `Name: a<spaces>b` followed by a folded line does.
- The CRLF doesn't have to be adjacent to the run. Any later fold, or possibly a CRLF without trailing whitespace, is enough to get past the fast path. I haven't run the parser to see whether `http.client` ever leaves that second form in a value.
- A run that ends right at the CRLF isn't the bad case, because the match succeeds.

**Is it attacker-controlled?**
- Yes, in the sense that the response bytes come from the server. A hostile or compromised server, or a man-in-the-middle on plain HTTP, can choose the value.
- It is bounded. From memory, `http.client` limits each header line to 64 KiB (`_MAXLINE`) and the number of headers to 100. I haven't checked either figure here. A single line would then give n ≈ 65,000 and roughly 2×10⁹ steps, which would be seconds of CPU in the regex engine. Continuation lines are separate lines, so a value that is a long run could be spread over several lines. Multiple headers could multiply the cost further.
- This is a denial-of-service concern, not a correctness bug. The code comment names the concern, but no test sends a long run, so a regression would not be caught. [[diff:src-urllib3-connection.py:80-82]] [[diff:test-test_connection.py:214-222]]

**What the lookbehind is for**
It keeps the rewrite cost linear in value length, so the "unfold every value" step does not give a server a cheap way to burn client CPU. That serves the same invariant as the rest of the change: normalizing headers must not make response handling riskier than before.

### Follow-ups

- How would a regression test for this look? | ask: Write a unit test for `_normalize_header_value` that fails if `(?<![ \t])` is removed, using a long interior whitespace run plus a trailing fold, and say how to assert it finishes quickly without being flaky.
- What does `http.client` actually cap? | ask: What per-line and per-response header limits does `http.client` enforce, and does a folded continuation line count against them separately?

```json
{"anchor": {"quote": "avoids quadratic backtracking", "hostBlock": "card:decisions"}, "contribute": {"open_questions": ["Does http.client enforce _MAXLINE (64 KiB) per header line including continuation lines, bounding the whitespace run length an attacker can send into _OBSOLETE_FOLD_RE? Answered from memory, not run."]}}
```