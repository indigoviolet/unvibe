A description/code mismatch means the words describing the change disagree with what the change does. This one is that kind of finding, not a functional bug: RFC 9112 allows replacing each obs-fold with one or more spaces, so the code's two spaces are within the standard even though the description says one.

It still matters for two reasons. First, the checklist is a contract with the reader: if the list says one space and the code produces two, the list is wrong. Second, the result depends on an asymmetry that no reader would guess — whitespace before a fold is absorbed into the replacement, but whitespace left over from a previous fold is not.

A "reader" here is whoever comes after: the next person to touch the regex or its test. For them the fix is small either way.

To close it, either fix the description and test name to say "one space per fold", or change the regex so adjacent folds collapse to one space. A short comment on the test case would also help.

```json
{"slower": {"cardId": "assessment-adjacent-folds"}}
```
