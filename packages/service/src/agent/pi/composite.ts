/**
 * Composite `AgentRunner`: claude/codex through the ACP runner (unchanged),
 * `pi` through the native pi runner (`./pi-runner.js`).
 *
 * The factory returns this whenever a `pi` binary is detected, so `pi`
 * appears as a provider with no changes to the claude/codex path: every
 * method routes on the session's (or requested) provider.
 */
import type { AgentEvent, AgentRunner, McpServerConfig, Session } from "@unvibe/shared";
import type { AcpAgentRunner } from "../acp/index.js";
import { PI_PROVIDER } from "./detect.js";
import { PiAgentRunner } from "./pi-runner.js";

export class CompositeAgentRunner implements AgentRunner {
  constructor(
    private readonly acp: AgentRunner & AcpAgentRunner,
    private readonly pi: PiAgentRunner,
  ) {}

  private forProvider(provider: string): AgentRunner {
    return provider === PI_PROVIDER ? this.pi : this.acp;
  }

  private forSession(session: Session): AgentRunner {
    return this.forProvider(session.provider);
  }

  start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
    readOnly?: boolean;
    effort?: string;
  }): Promise<Session> {
    return this.forProvider(opts.provider).start(opts);
  }

  fork(session: Session, opts?: { atMessage?: string }): Promise<Session> {
    const runner = this.forSession(session);
    if (typeof runner.fork !== "function") {
      throw new Error(`provider ${JSON.stringify(session.provider)} does not support fork`);
    }
    return runner.fork(session, opts);
  }

  load(sessionId: string): Promise<Session> {
    // Loads route by stored record: pi ids live in the pi runner's
    // sidecars, everything else in the ACP runner.
    if (this.pi.owns(sessionId)) return this.pi.load(sessionId);
    return this.acp.load(sessionId);
  }

  prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    return this.forSession(session).prompt(session, text, signal);
  }

  close(session: Session): Promise<void> {
    return this.forSession(session).close(session);
  }

  takeSessionStartUsage?(sessionId: string): { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number } | undefined {
    const acp = this.acp as AgentRunner & {
      takeSessionStartUsage?: (id: string) => { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number } | undefined;
    };
    return acp.takeSessionStartUsage?.(sessionId);
  }

  async listModels(provider: string): Promise<{ id: string; name?: string; description?: string }[]> {
    const runner = this.forProvider(provider) as AgentRunner & {
      listModels: (p: string) => Promise<{ id: string; name?: string; description?: string }[]>;
    };
    return runner.listModels(provider);
  }

  async listModelsWithDefault(provider: string): Promise<{ models: { id: string; name?: string; description?: string }[]; defaultId: string | null }> {
    const runner = this.forProvider(provider) as AgentRunner & {
      listModelsWithDefault?: (p: string) => Promise<{ models: { id: string; name?: string; description?: string }[]; defaultId: string | null }>;
      listModels: (p: string) => Promise<{ id: string; name?: string; description?: string }[]>;
    };
    if (typeof runner.listModelsWithDefault === "function") return runner.listModelsWithDefault(provider);
    return { models: await runner.listModels(provider), defaultId: null };  }

  async listThinking(provider: string): Promise<{ configId: string; current: string; options: { value: string; name?: string; description?: string }[] }[]> {
    const runner = this.forProvider(provider) as AgentRunner & {
      listThinking?: (p: string) => Promise<{ configId: string; current: string; options: { value: string; name?: string; description?: string }[] }[]>;
    };
    if (typeof runner.listThinking === "function") return runner.listThinking(provider);
    return [];
  }

  /** Providers this composite serves (pi only when its binary is present). */
  providers(): string[] {
    const out = ["claude", "codex"];
    try {
      if (this.pi.isAvailable()) out.push(PI_PROVIDER);
    } catch {
      // detection never throws, but never let it break the catalog
    }
    return out;
  }

  /** True when the pi side is usable (binary present). */
  piAvailable(): boolean {
    try {
      return this.pi.isAvailable();
    } catch {
      return false;
    }
  }

  clearModelCache(): void {
    try {
      (this.acp as unknown as { clearModelCache?: () => void }).clearModelCache?.();
    } catch {
      // ignore
    }
    this.pi.clearModelCache();
  }

  restartTransports(reason = "reload"): void {
    try {
      (this.acp as unknown as { restartTransports?: (r?: string) => void }).restartTransports?.(reason);
    } catch {
      // ignore
    }
    void this.pi.dispose().catch(() => {});
    void reason;
  }

  async dispose(): Promise<void> {
    await Promise.all([
      (async () => {
        try {
          await (this.acp as unknown as { dispose?: () => Promise<void> }).dispose?.();
        } catch {
          // ignore
        }
      })(),
      this.pi.dispose().catch(() => {}),
    ]);
  }
}
