/**
 * Replay markers for the recorded runner (demo/tests only).
 *
 * The `ReplayAgentRunner` matches prompts via an explicit
 * `replay-kind:`/`replay-key:` marker or via keyword guessing. Pipeline
 * prompts include these markers as trailing HTML comments when the runner
 * is a replay runner, so demo runs are deterministic. Real-model prompts
 * never include them (the model would see them as instructions).
 */
export function withReplayMark(prompt: string, replay?: { kind: string; key?: string }): string {
  if (!replay) return prompt;
  const key = replay.key ? ` replay-key: ${replay.key}` : "";
  return `${prompt}\n\n<!-- replay-kind: ${replay.kind}${key} -->`;
}
