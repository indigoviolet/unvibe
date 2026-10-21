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
    /**
     * Thinking level for the session (issue #172): an adapter-offered
     * effort value. Absent or "" means Default — leave the adapter's own
     * setting alone. Forks inherit their parent's value; `load` keeps it.
     */
    effort?: string;
  }): Promise<Session>;
  /** Optional capability: fork a session (ACP `session/fork`, unstable). */
  fork?(session: Session, opts?: { atMessage?: string }): Promise<Session>;
  /**
   * Issue #209: consume a session's session-start (warm-up) usage, if the
   * runner tracks any. The pipeline attributes it to the job's
   * "session start" turn record so the first real turn's usage is that
   * turn alone; without this the warm cost lands folded into the first
   * turn. Returns undefined when the runner reports none (fakes, Codex,
   * non-empty system prompts). Consuming: a second call for the same
   * session returns undefined.
   */
  takeSessionStartUsage?(sessionId: string): {
    inputTokens: number;
    cachedReadTokens: number;
    cachedWriteTokens: number;
    outputTokens: number;
  } | undefined;
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
      /** Adapter's tool-call id, when it sends one (correlates start/end). */
      id?: string;
      /**
       * Issue #160: best-effort detail captured from the tool-call update
       * (e.g. the shell command or URL, when the adapter sends it),
       * truncated by the runner. Absent when the adapter sends none.
       */
      detail?: string;
      /**
       * Issue #207: on `end`, the tool's result text as the adapter
       * reported it (untruncated here; the job record truncates it).
       * Absent when the adapter sends no result content.
       */
      result?: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      cachedReadTokens: number;
      cachedWriteTokens: number;
      outputTokens: number;
      /**
       * Issue #207: the raw usage payload exactly as the runner reported
       * it (for ACP, `{ usage, _meta }` from the prompt response), stored
       * verbatim on the job's turn record next to the derived counts
       * above. Never reinterpreted. Absent when the runner has none.
       */
      raw?: unknown;
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
