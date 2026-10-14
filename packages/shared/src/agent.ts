/**
 * Agent runner contract (PRD §6, verbatim interface).
 *
 * ACP lives ONLY in `packages/service/src/agent/acp/`. Everything else
 * uses this interface.
 */

export interface AgentRunner {
  start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
    /**
     * Read-only posture (issue #160): file reads + our MCP tools only,
     * edits/shell/network denied. Defaults to true; full access passes
     * false. A session keeps the posture it started with until it ends.
     */
    readOnly?: boolean;
  }): Promise<Session>;
  /** Optional capability: fork a session (ACP `session/fork`, unstable). */
  fork?(session: Session, opts?: { atMessage?: string }): Promise<Session>;
  /** Reopen a session after an idle close. */
  load(sessionId: string): Promise<Session>;
  prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  close(session: Session): Promise<void>;
}

export interface Session {
  id: string;
  provider: string;
  model: string;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | {
      type: "tool";
      name: string;
      status: "start" | "end";
      /**
       * Issue #160: best-effort detail captured from the tool-call update
       * (e.g. the shell command or URL, when the adapter sends it),
       * truncated by the runner. Absent when the adapter sends none.
       */
      detail?: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      cachedReadTokens: number;
      cachedWriteTokens: number;
      outputTokens: number;
    }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string; retryable: boolean };

/**
 * MCP server config passed per session (PRD §6: "accepts per-session MCP
 * servers"). The PRD does not fix the shape, so this is the scaffold
 * decision: stdio servers use `command` + `args`, HTTP servers use `url`.
 * Exactly one of `command` / `url` must be set.
 */
export interface McpServerConfig {
  name: string;
  command?: string[];
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}
