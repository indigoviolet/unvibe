The delta since v1 is one reworked hunk: alpha now returns 111, as
the "rework alpha" commit message says. The earlier guide is untouched —
this section alone explains the change and why.

```json
{
  "baseline": {
    "kind": "version",
    "version": 1
  },
  "sinceHunks": {
    "added": [],
    "changed": [
      "h:src-app.py:659fc4a4a13ac005"
    ]
  },
  "sinceSection": {
    "cards": [
      {
        "id": "since-alpha-111",
        "title": "Alpha reworked",
        "blocks": "Alpha now returns 111 instead of 11. The rework-alpha commit says the reviewer asked for 111, so this answers that remark. It affects the central card, which still describes the old value. [[h:src-app.py:659fc4a4a13ac005]]"
      }
    ]
  }
}
```
