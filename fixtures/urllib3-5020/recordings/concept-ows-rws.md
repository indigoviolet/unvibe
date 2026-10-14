HTTP's grammar names its whitespace. `OWS` is optional whitespace (zero or more spaces or tabs) and `RWS` is required whitespace (at least one). A fold is `OWS CRLF RWS`: maybe some spaces, the line break, then at least one space or tab starting the next line. That's exactly the shape of the PR's regex. [[diff:conn:82]]

::: simple
"Optional spaces, a line break, then at least one space": that's what a fold looks like, and that's what the code searches for.
:::

```json
{
  "title": "OWS and RWS: whitespace in HTTP"
}
```
