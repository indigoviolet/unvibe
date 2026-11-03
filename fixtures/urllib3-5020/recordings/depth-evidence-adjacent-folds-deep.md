The description says adjacent folds collapse to one space, and the unit test expects two. The regex is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. It matches one whole fold: optional whitespace (OWS), the CRLF, then required whitespace (RWS). `re.sub` replaces each match with one space, so the output has one space per match.

The lookbehind has no say in how many matches there are. It only limits where the optional leading whitespace may start, and it exists to bound backtracking cost: a match that began mid-run could always have begun at the run's first character. So any claim about how adjacent folds combine has to come from the matching rule (what one match consumes, and where the scan resumes). It cannot come from the lookbehind.

For `"one\r\n \r\n\tthree"`, the first match is `\r\n `. Its trailing `[ \t]+` consumes the space after the first CRLF, and that match becomes one space. `re.sub` matches do not overlap, so the scan resumes at the second `\r`. The second fold has no leading whitespace left to take, because the only candidate was already consumed. It matches as `\r\n\t` and becomes a second space.

The lookbehind is not the cause. At the second `\r` the optional group has nothing to match, because `[ \t]+` cannot match `\r`. The pattern therefore gives the same result with or without the lookbehind. The other cards in this guide blame the lookbehind for blocking the group, and that attribution is wrong. The outcome follows from non-overlapping matching alone.

The test pins the result as `"one  three"`, with two spaces. A fold whose continuation line holds only whitespace therefore yields two spaces. This is an emergent property of the pattern: no line of the code states it, and the test records what the implementation does, not what a requirement says.

Merging the two spaces into one would need a different rule, for example one that matches a whole run of folds, such as `(?:[ \t]*\r\n[ \t]+)+`. RFC 9112 only asks that each fold become SP, so two spaces are acceptable. If someone changed the pattern to merge them, this test would fail. That is the right outcome only if the change is intended.

The description and the guide state a different behavior, "adjacent folds collapse to one space, not zero". The code gives one space per fold. The claim would hold only if the second fold's space were merged into the first, and nothing in the pattern does that. A checklist item that says "collapse to one" would fail if someone ran it on this input. The output is still valid, so the wording is wrong and the code is not.

The socket test has no adjacent-fold case. Its mixed case, `one \t\r\n\t  two\t \r\n \tthree`, has non-whitespace (`two`) between the folds. Each fold there is a separate match with its own text on both sides. It never reaches the situation where one match consumes whitespace that the next fold would otherwise use. Only the unit test covers the adjacent case, so nothing checks it through the real `getresponse` path.

::: principle
When a test pins an output that comes from how a pattern happens to match, and not from a stated requirement, name the actual mechanism (here, non-overlapping matches). A wrong explanation, such as blaming the lookbehind, survives until someone changes the part it blamed and the output doesn't move.
:::

```json
{"depth": {"level": "deep", "cardId": "evidence-adjacent-folds"}}
```