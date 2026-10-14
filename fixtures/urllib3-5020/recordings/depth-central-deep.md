Normalize the source, then derive. The fix rewrites the `HTTPMessage` in place (same object, same order, same duplicates) and builds `HTTPHeaderDict` from the same normalized list. Both views are equal by construction, and nothing downstream has to know folding ever existed. [[diff:conn:91-110]] [[diff:conn:650-651]]

Two properties are enforced together: a semantic one (no CR or LF in values) and a performance one (cost linear in input). The second matters because response headers are attacker-controlled input; a pattern that backtracks quadratically would turn a cleanup step into a [[concept:regex-performance|denial-of-service]] vector. [[diff:conn:80-88]]

::: underlying-principle
When two representations of the same data exist, normalize the source and derive the others from it, so they agree by construction instead of by careful syncing.
:::

```json
{
  "title": "The central change",
  "depth": {"level": "deep", "cardId": "central"}
}
```
