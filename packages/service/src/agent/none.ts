/**
 * No-agent runner (`UNVIBE_AGENT=none`): the pipeline is disabled and every
 * agent call fails fast with a clear message.
 *
 * Use it in tests (and local runs) that exercise everything except agent
 * behaviour — comments, submit, diff, versions — so no background pipeline
 * mutates the review while the test runs, and so a non-fixture repo never
 * receives the fixture's replayed guide content. `replay` stays for the
 * specs that test agent behaviour (demo review, second opinion); the
 * default (unset/anything else) is the real ACP runner.
 */
import type { AgentRunner, Session } from "@unvibe/shared";

export const NO_AGENT_MESSAGE =
  "no agent configured (UNVIBE_AGENT=none): set UNVIBE_AGENT=replay for recordings or configure ACP models";

function fail(): never {
  throw new Error(NO_AGENT_MESSAGE);
}

export class NoAgentRunner implements AgentRunner {
  /** Marker for `isNoneRunner` (the `AgentRunner` interface has none). */
  readonly none = true;

  async start(): Promise<Session> {
    fail();
  }

  async load(): Promise<Session> {
    fail();
  }

  async *prompt(): AsyncIterable<never> {
    fail();
    // Unreachable: satisfies the async-generator shape for callers.
    yield* [];
  }

  async close(): Promise<void> {
    fail();
  }
}
