/**
 * Isolation guards (PRD §12).
 *
 * - Small-model jobs get only what they need: `runSmall` prompts carry just
 *   the rendered task template — never the base, never the log, never
 *   contributions. This module's `assertSmallPromptIsolated` fails a prompt
 *   that carries shared-context text it must not see.
 * - Second-opinion contexts never include L2, L3, contributions or uncited
 *   pins: `buildSecondOpinionContext` (context/secondOpinion.ts) only accepts
 *   instructions + L1 source + cited excerpts, so guide/findings text has no
 *   parameter to travel through. `assertSecondOpinionIsolated` fails any
 *   prompt that leaks log or contribution text.
 *
 * Both asserts take the probe strings the test planted (guide sentences,
 * log lines, contribution text, uncited pin bodies) and throw on the first
 * leak, naming it. Tests plant unique probes so a failure pinpoints the
 * leak.
 */
import { buildSecondOpinionContext, type CodeExcerpt } from "../context/secondOpinion.js";

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

/** Throw when a second-opinion prompt carries L2/L3/contribution text. */
export function assertSecondOpinionIsolated(
  prompt: string,
  probes: { label: string; text: string }[],
): void {
  assertNoLeak(prompt, probes, "second-opinion prompt");
}

export interface IsolatedSecondOpinionInput {
  instructions: string;
  sourceText: string;
  codeExcerpts: CodeExcerpt[];
  citedIds: string[];
}

/**
 * Build a second-opinion prompt through the only allowed channel. Guide
 * markdown, findings, contributions and uncited pins are not parameters, so
 * they cannot leak — a test fails the build if any probe text reaches the
 * result.
 */
export function buildIsolatedSecondOpinionPrompt(input: IsolatedSecondOpinionInput): string {
  return buildSecondOpinionContext(input).text;
}
