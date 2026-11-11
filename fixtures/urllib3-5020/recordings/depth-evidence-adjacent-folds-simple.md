The description says adjacent folds (two folds with nothing between them) give one space. The unit test expects two spaces. The regex is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. Its lookbehind lets the optional leading blanks match only at the start of a run of blanks. [[diff:src-urllib3-connection.py:80-82]]

Take the value `"one\r\n \r\n\tthree"`. The first match is `\r\n ` and becomes one space. The second fold starts right after it. The character before it is the space the first match just used. The lookbehind says a blank run cannot start there, so the second match cannot take that space. It matches only `\r\n\t` and becomes a second space. [[diff:src-urllib3-connection.py:80-82]]

The test expects `"one  three"`, with two spaces. [[diff:test-test_connection.py:220]]

The description and the guide say "adjacent folds collapse to one space, not zero". The code does not do that. Each fold gives one space.

The socket test has no case with adjacent folds. Its mixed case is `one \t\r\n\t  two\t \r\n \tthree`. It has the word `two` between the two folds. [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

```json
{"depth": {"level": "simple", "cardId": "evidence-adjacent-folds"}}
```