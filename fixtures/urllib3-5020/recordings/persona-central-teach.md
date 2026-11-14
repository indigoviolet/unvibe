::: background
urllib3 reads a response's headers once, when it parses the status line and header block, and keeps two copies: the parsed view the caller reads, and the raw lines it keeps for debugging. [[diff:conn:91-110]]
:::

### What the change does

The change adds one normalize step right after parsing. Every folded header line is unfolded there, before either copy is built, so both copies agree. [[diff:conn:91-110]]

- **Where it runs:** once per response, straight after the header block is parsed.
- **What it changes:** a continuation line is joined onto the header it continues.
- **What it leaves alone:** headers that were never folded pass through unchanged.

```json
{}
```
