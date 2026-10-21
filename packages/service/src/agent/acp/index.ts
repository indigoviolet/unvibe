/**
 * Public surface of the ACP module. Only this directory may import
 * `@agentclientprotocol/*` (enforced by eslint no-restricted-imports + a
 * unit test that greps the tree).
 */
export { AcpAgentRunner, SHARED_CACHE_FIRST_TURN, type AcpRunnerOptions } from "./runner.js";
export { type ModelInfo, type ThinkingInfo, type AcpStartOptions, PROVIDERS } from "./types.js";
export { addTurnUsage, aggregateTurnUsage, cacheReadShare, emptyUsage, type TurnUsage } from "./usage.js";
export { isRetryableError, errorMessage } from "./errors.js";
export { decidePermission, isOurMcpTool } from "./permissions.js";
