## The problem

The feature branch changes what `partial_one` returns, adding a marker comment above the new value. [[diff:src-shape_alpha.py:1-3]]

## The central idea

Keep the function's shape and only change the returned constant: `partial_one` returns 11 where it returned 1, with the marker comment above it. [[diff:src-shape_alpha.py:1-3]]

## Decisions and questions

**Decisions**
- **One line changed.** The edit touches a single return value and nothing else, so it could land on its own. [[diff:src-shape_alpha.py:1-3]]

```json
{"pendingCards": [{"id": "g-shape-a1", "label": "Why change the return value", "why": "Lets you judge what the new return value is for."}, {"id": "g-shape-a2", "label": "Who reads partial_one", "why": "Shows which callers depend on the new value."}, {"id": "g-shape-a3", "label": "What tests cover the value", "why": "Lets you see whether the new value is asserted anywhere."}]}
```
