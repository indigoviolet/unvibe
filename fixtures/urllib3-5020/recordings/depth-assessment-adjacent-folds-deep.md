## Assessment

This is a description/code mismatch, not a functional bug. RFC 9112 allows replacing each obs-fold with one or more SP, so two spaces is acceptable. [[diff:test-test_connection.py:220]]

::: simple
This is a mismatch between the description and the code. It is not a bug in how the code works. RFC 9112 lets a recipient replace each fold with one or more spaces, so two spaces is fine.
:::

::: deep
The RFC states the requirement as an output property, not as an exact string. After unfolding, the value must contain no CRLF framing, and no fold may survive. Each fold is replaced by one or more SP octets, so the property is "a single line, with spaces where the folds were". `"one  three"` has that property, so the code is within the RFC. A downstream consumer that treats the value as one logical line cannot tell one space from two, so the conformance requirement is met. The description's "one space" is a claim about this implementation's output, not a rule from the spec. The claim is stronger than the RFC requires and stronger than what the code does. That makes the defect one of documentation, not of behaviour. [[diff:test-test_connection.py:220]]
:::

It still matters for two reasons:

::: simple
It still matters, for two reasons:
:::

::: deep
It still matters for two reasons, and they are different kinds of problem. One is about verification and the other is about mechanism.
:::

- The checklist item "adjacent folds collapse to one space" would fail if someone ran it.
- The result depends on an asymmetry: whitespace before a fold is absorbed, but whitespace after a previous fold is not. A reader will not expect that.

To close it, either fix the description and test name to say "one space per fold", or change the regex so adjacent folds collapse to one space. A short comment on the test case would also help.

::: simple
There are two ways to fix it. You can change the description and the test name to say "one space per fold". Or you can change the regex so adjacent folds collapse to one space. A short comment on the test case would also help.
:::

::: deep
The first reason is about verification. A checklist item is an executable claim: it names an input and an expected output. Run against `"one\r\n \r\n\tthree"`, it yields `"one  three"`, and the reviewer cannot tell whether the code or the prose is the intended behaviour. The unit test pins two spaces, so code and test agree and only the prose disagrees. When one of three artifacts is out of line, the cheapest repair is to fix the one that is not executable. [[diff:test-test_connection.py:220]]

The second reason is about mechanism, and the lookbehind is not the cause. `re.sub` finds non-overlapping matches from left to right. The first match is `\r\n ` and its mandatory trailing `[ \t]+` consumes the space after the first CRLF. That same space is also the whitespace before the second CRLF, but it is already spent. The scan resumes at the second `\r`, where the optional leading group has nothing to match, so the second fold matches only `\r\n\t`. Each blank can belong to only one match, and that fixes the outcome. The pattern would give the same result without the lookbehind, which exists only to bound backtracking cost. [[diff:src-urllib3-connection.py:80-82]]

The effective rule is therefore "leading blanks are absorbed unless a previous fold already claimed them". No line of the code states it, because it falls out of left-to-right matching. A reader who assumes the RFC's OWS CRLF RWS definition applies to each fold independently will expect one space. Two ways to remove the surprise are available. One is to state "one space per fold" as the contract, which matches the code and the test. The other is to change the pattern so that runs of folds and blanks collapse together, for example by matching `(?:[ \t]*\r\n)+[ \t]+`. That second option changes behaviour and needs its own tests, including one for a long blank run.
:::

::: principle
When an output comes from how a matcher consumes input, and not from a stated requirement, the documentation should describe the output the matcher actually produces. The loosest prose that is still true is better than a tidy claim that a test would contradict.
:::

```json
{"depth": {"level": "deep", "cardId": "assessment-adjacent-folds"}}
```