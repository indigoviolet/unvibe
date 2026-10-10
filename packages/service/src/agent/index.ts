/**
 * AgentRunner surface for the service. The interface itself lives in
 * `@unvibe/shared` (the contract); this module re-exports it plus the fake
 * used by all tests. Real ACP adapters live ONLY in `./acp/`.
 */
export type {
  AgentEvent,
  AgentRunner,
  McpServerConfig,
  Session,
} from "@unvibe/shared";
export { FakeAgentRunner } from "./fake.js";
