::: example
```
value = "a" + " " * 20000 + "b\r\n"      # hypothetical, a CRLF is present so the fast path is skipped

without lookbehind, start at blank k of the run:
  [ \t]+ takes the remaining (20000 - k) blanks
  \r\n fails on "b"
  back off one blank, retry \r\n, fail   ... repeated (20000 - k) times
  total ≈ 20000 + 19999 + ... + 1 ≈ 2 × 10^8 steps

with (?<![ \t]):
  start at blank 0   -> group runs once, backs off n times, fails       (~n steps)
  start at blank k>0 -> lookbehind sees a blank, fails in O(1)          (~n steps total)
```
This input is hypothetical, built from the same shape as the code comment's claim. The cost comes from the number of start offsets inside one run, not from the length of any single attempt. The general rule is that a greedy optional prefix before a literal makes a backtracking engine pay for every start position. An anchor such as a lookbehind lets each run be tried only once. [[diff:src-urllib3-connection.py:80-82]] [[diff:src-urllib3-connection.py:85-88]]
:::

::: example
```
value = "a\r\nb"                 # hypothetical: CRLF, but no SP/HTAB after it

_OBSOLETE_FOLD_RE.sub(" ", value)   -> "a\r\nb"     (trailing [ \t]+ cannot match "b", no match)
value.split("\r\n")                 -> ["a", "b"]   (split cuts here as well)

value = "a \r\n b"               # a real fold
regex sub                           -> "a b"
split + rstrip/lstrip + " ".join    -> "a b"
```
On a real fold both approaches agree. On `"a\r\nb"` the split has already cut at a CRLF that is a line end and not a fold. The code would need a second check to avoid merging the two pieces. The regex gets this from its mandatory trailing `[ \t]+`. When one pattern is the definition of the construct, the "leave this alone" cases come for free. A split-based version has to re-derive them. [[diff:src-urllib3-connection.py:80-88]]
:::

::: example
```
value = "one\r\n \r\n\tthree"

match 1: "\r\n "          (index 3-5; trailing [ \t]+ takes the space)
         -> " "
scan resumes at the second "\r"; no blank is left for the optional group
match 2: "\r\n\t"
         -> " "
result:  "one" + " " + " " + "three" = "one  three"
```
This is the adjacent-fold case the unit test pins. Matches do not overlap, so the space after the first CRLF belongs to match 1 and cannot also be leading whitespace for match 2. The optional group has nothing to match at a `\r`, with or without the lookbehind. The rule is one space per fold, and a continuation line made only of blanks gives two. [[diff:test-test_connection.py:220]] [[diff:src-urllib3-connection.py:80-82]]
:::

::: example
```
# a test that separates the two versions (sketch)
small = "a" + " " * 1_000   + "b\r\n"
large = "a" + " " * 100_000 + "b\r\n"

linear pattern:    large takes ≈ 100 × as long as small
no lookbehind:     large takes ≈ 10,000 × as long as small
```
All current cases use runs of a few blanks, so both versions return the same strings instantly and every assertion stays green. Only an input with a long run can tell them apart. Comparing how the time grows between two sizes avoids a flaky wall-clock threshold. The general rule is that a property of cost needs an input large enough to make the cost visible. [[diff:test-test_connection.py:214-224]] [[diff:src-urllib3-connection.py:80-82]]
:::

```json
{"title": "The _OBSOLETE_FOLD_RE lookbehind", "depth": {"level": "deep", "cardId": "g-regex"}, "contribute": {"facts": []}}
```