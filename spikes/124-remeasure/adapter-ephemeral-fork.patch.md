# Spike-only adapter patch: ephemeral Codex forks (shared prompt_cache_key)

Codex 0.162.1 reuses the parent's `prompt_cache_key` only for **ephemeral**
forks (see `docs/latency-124-remeasure.md`, cache-key section). The shipped
`@agentclientprotocol/codex-acp` 2.2.2 never sends `ephemeral` on
`thread/fork`, and ACP `session/fork` has no field for it, so the spike
patches the installed adapter bundle locally (node_modules is not
committed) behind an env flag. Production must not use this patch; it
exists only to test the hypothesis.

Apply to `node_modules/@agentclientprotocol/codex-acp/dist/index.js`
(v2.2.2, in `forkSession`, `src/SessionFork.ts` compiled output):

```diff
   const response = await dependencies.codexClient.threadFork({
     excludeTurns: true,
+    ...(process.env.UNVIBE_CODEX_FORK_EPHEMERAL === "1" && { ephemeral: true }),
     config: sessionConfig.config,
     cwd: request.cwd,
     ...lastTurnId !== void 0 && { lastTurnId },
     modelProvider: await dependencies.getResumeModelProvider(),
     threadId: request.sessionId
   });
```

Run with the flag set (it propagates through the ACP runner's adapter
spawn env):

```sh
UNVIBE_CODEX_FORK_EPHEMERAL=1 mise run test:live:124-fork-cache
```

Caveat: ephemeral threads are not persisted on disk
(`Config.ephemeral`: "session is not persisted on disk"). A production
version needs the adapter to forward an explicit fork-ephemeral option
(or Codex to support a stable cache key directly); it cannot be done
from the ACP client side alone.
