/**
 * Internal types for the ACP AgentRunner.
 *
 * Nothing outside `packages/service/src/agent/acp/` may import ACP SDK
 * types directly; other modules use `@unvibe/shared` (`AgentRunner`,
 * `Session`, `AgentEvent`) plus the narrow surface re-exported here.
 */
import type { McpServerConfig } from "@unvibe/shared";

export type ProviderId = "claude" | "codex";

export const PROVIDERS: readonly ProviderId[] = ["claude", "codex"] as const;

export function normalizeProvider(provider: string): ProviderId {
  if (provider === "claude" || provider === "codex") return provider;
  throw new Error(`unknown ACP provider ${JSON.stringify(provider)} (expected "claude" or "codex")`);
}

/** Per-session record kept by the runner. */
export interface AcpSessionRecord {
  /** ACP session id (adapter-assigned UUID). */
  acpSessionId: string;
  provider: ProviderId;
  /** Model id as selected (adapter's config value, e.g. "opus", "default"). */
  model: string;
  /**
   * Thinking level as selected (adapter's effort value, "" = adapter
   * default). Reapplied on fork, resume and load so sessions started from
   * this one keep it (#172; #121 showed forks losing session settings).
   */
  effort: string;
  cwd: string;
  mcpServers: McpServerConfig[];
  systemPrompt: string;
  readOnly: boolean;
  createdAt: number;
}

/** Model entry returned by listModels(). */
export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
}

/** Thinking/effort option entry (e.g. Claude `effort`, Codex `reasoning_effort`). */
export interface ThinkingInfo {
  /** Config option id on the adapter (e.g. "effort", "reasoning_effort"). */
  configId: string;
  current: string;
  options: Array<{ value: string; name?: string; description?: string }>;
}

/** Options for start() beyond the shared AgentRunner contract. */
export interface AcpStartOptions {
  provider: string;
  model: string;
  cwd: string;
  systemPrompt: string;
  mcpServers: McpServerConfig[];
  /** Read-only posture: file reads + our MCP tools only, no edits/shell/network. */
  readOnly?: boolean;
  /** Thinking level (adapter effort value, "" = adapter default). */
  effort?: string;
}
