The explanation in more depth. The fix normalizes the source once and derives the other views from it, so they agree by construction. [[diff:conn:91-110]] [[diff:conn:650-651]]

The same two properties hold here: values carry no CR or LF, and the cost stays linear in the input length. [[diff:conn:80-88]]

::: underlying-principle
When two representations of the same data exist, normalize the source and derive the others from it, so they agree by construction instead of by careful syncing.
:::

```json
{
  "title": "Explanation",
  "depth": {"level": "deep", "cardId": "expansion"}
}
```
