The delta since v1 is one reworked hunk: alpha now returns 111, as
the "rework alpha" commit message says. The earlier guide's central card
keeps its text; the addendum below records what changed relative to it.
A new follow-up thread starts here, so it gets its own plotline.

```json
{
  "revisedCards": [],
  "recheckedFindings": [],
  "newFindings": [],
  "hunkSummaries": {
    "659fc4a4a13ac005": "Alpha returns 111."
  },
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
        "pageId": "since",
        "title": "Alpha reworked since v1",
        "level": "standard",
        "collapsed": false,
        "revision": 1,
        "undoStack": [],
        "blocks": [
          {
            "type": "paragraph",
            "id": "b-since-alpha-1",
            "text": {
              "standard": "Alpha now returns 111 instead of 11. The rework-alpha commit says the reviewer asked for 111, so this answers that remark. It affects the central card, which still describes the old value — see its addendum."
            },
            "citations": [
              {
                "target": "h:src-app.py:659fc4a4a13ac005"
              }
            ]
          }
        ]
      }
    ]
  },
  "addenda": [
    {
      "cardId": "problem",
      "blocks": [
        {
          "type": "paragraph",
          "id": "b-add-alpha-1",
          "text": {
            "standard": "Updated since v1: alpha returns 111 now, not 11 as this card says."
          },
          "citations": [
            {
              "target": "h:src-app.py:659fc4a4a13ac005"
            }
          ]
        }
      ]
    }
  ],
  "plotlineAssignments": {
    "659fc4a4a13ac005": "delta"
  },
  "newPlotlines": [
    {
      "id": "delta",
      "name": "Follow-up hardening",
      "description": "The alpha rework and the checks around the new value."
    }
  ]
}
```
