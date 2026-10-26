/**
 * Native pi runner surface (issue #279, route 2: `pi --mode rpc`).
 *
 * `PiAgentRunner` is a second `AgentRunner` implementation next to the ACP
 * one (`../acp/`); `CompositeAgentRunner` routes claude/codex to ACP and
 * `pi` to the pi runner. Nothing here imports `@agentclientprotocol/*`.
 */
export { PiAgentRunner, piEnvFor, PI_REVIEW_TOOLS, PI_STATIC_MODELS, type PiRunnerOptions } from "./pi-runner.js";
export { CompositeAgentRunner } from "./composite.js";
export { PI_PROVIDER, PI_BIN_ENV, findPiOnPath, isPiAvailable, resolvePiBin, piInstallHint, type ResolvedPiBin } from "./detect.js";
export { PI_EXTENSION_SOURCE } from "./extension.js";
