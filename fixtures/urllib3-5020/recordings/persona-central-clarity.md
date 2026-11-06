The central change reads more directly now: both copies of the headers go through one normalize step, right after parsing, so every obs-fold unfolds before anything else sees it. [[diff:conn:91-110]]

Header deletion still scans by name, which costs one scan per deletion — fine in practice because folded responses are rare. [[diff:conn:102]]

```json
{}
```
