/** Token guard (#188): real agents only when explicitly allowed. */
export const LIVE_AGENT_FLAG = "UNVIBE_ALLOW_LIVE_AGENT";

export function isLiveAgentAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_AGENT_FLAG] === "1";
}

export function assertLiveAgentAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (!isLiveAgentAllowed(env)) {
    throw new Error(
      "Refusing to start a real agent: UNVIBE_ALLOW_LIVE_AGENT is not \"1\". " +
        "Real agents spend tokens and are only allowed from the product entry (serve()) " +
        "or a `mise run test:live:*` task. Set UNVIBE_AGENT=replay or UNVIBE_AGENT=none for tests, " +
        "or run via `mise run test:live:*` to allow a real agent.",
    );
  }
}
