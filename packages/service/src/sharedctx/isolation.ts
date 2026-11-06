/**
 * Isolation guards (PRD §12).
 *
 * Small-model jobs get only what they need: `runSmall` prompts carry just
 * the rendered task template — never the base, never the log, never
 * contributions. This module's `assertSmallPromptIsolated` fails a prompt
 * that carries shared-context text it must not see.
 *
 * The assert takes the probe strings the test planted (guide sentences,
 * log lines, contribution text, uncited pin bodies) and throws on the first
 * leak, naming it. Tests plant unique probes so a failure pinpoints the
 * leak. (Issue #349 removed the second-opinion isolation helpers with the
 * dedicated second-opinion context builder.)
 */

/** Throw when `prompt` contains any of `probes`. Pure. */
export function assertNoLeak(prompt: string, probes: { label: string; text: string }[], where: string): void {
  for (const probe of probes) {
    if (probe.text && prompt.includes(probe.text)) {
      throw new Error(`${where} leaks ${probe.label}: ${JSON.stringify(probe.text.slice(0, 80))}`);
    }
  }
}

/** Throw when a small-model prompt carries shared-context text. */
export function assertSmallPromptIsolated(
  prompt: string,
  probes: { label: string; text: string }[],
): void {
  assertNoLeak(prompt, probes, "small-model prompt");
}
