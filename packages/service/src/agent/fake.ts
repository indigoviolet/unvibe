/**
 * Scripted fake AgentRunner: replays a list of AgentEvents per prompt.
 * Used by all tests so UI and pipeline tests never need live agents
 * (PRD §18).
 */
import type { AgentEvent, AgentRunner, McpServerConfig, Session } from "@unvibe/shared";

export interface FakeScript {
  /** Match prompts containing this substring; first match wins. */
  match: string;
  events: AgentEvent[];
}

export class FakeAgentRunner implements AgentRunner {
  readonly sessions = new Map<string, Session>();
  readonly prompts: { sessionId: string; text: string }[] = [];
  private nextId = 1;

  constructor(private scripts: FakeScript[] = []) {}

  addScript(script: FakeScript): void {
    this.scripts.push(script);
  }

  async start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  }): Promise<Session> {
    const session: Session = {
      id: `fake-${this.nextId++}`,
      provider: opts.provider,
      model: opts.model,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async fork(session: Session): Promise<Session> {
    return this.start({
      provider: session.provider,
      model: session.model,
      cwd: "",
      systemPrompt: "",
      mcpServers: [],
    });
  }

  async load(sessionId: string): Promise<Session> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`FakeAgentRunner: unknown session ${sessionId}`);
    return s;
  }

  async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
    this.prompts.push({ sessionId: session.id, text });
    const script = this.scripts.find((s) => text.includes(s.match));
    const events = script?.events ?? [{ type: "done", stopReason: "end_turn" } satisfies AgentEvent];
    for (const e of events) yield e;
  }

  async close(session: Session): Promise<void> {
    this.sessions.delete(session.id);
  }
}
