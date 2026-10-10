/**
 * Factory for the real ACP-backed AgentRunner.
 *
 * This module lives OUTSIDE `acp/` and must never import
 * `@agentclientprotocol/*` directly (lint-enforced). It only re-exports
 * the runner built inside `acp/`.
 */
import { AcpAgentRunner, type AcpRunnerOptions } from "./acp/index.js";
import type { AgentRunner } from "@unvibe/shared";

export function createAcpRunner(opts?: AcpRunnerOptions): AgentRunner & AcpAgentRunner {
  return new AcpAgentRunner(opts);
}

export type { AcpRunnerOptions };
