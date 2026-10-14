/**
 * Full-access opt-in (issue #160): the contract for letting agent sessions
 * run unrestricted.
 *
 * The default stays the read-only lock-down. Full access is a global
 * setting, off by default, that takes effect only together with a stored
 * acknowledgement of the warning. Turning it off clears the
 * acknowledgement, so turning it on again asks again.
 *
 * Enforcement vs instruction, per mode:
 * - lock-down (default): enforced by the adapter setup (reduced tool list,
 *   workspace-write mode, deny-by-default permission handler) AND stated
 *   in the prompt.
 * - full access: nothing is enforced. The agent's shell, file, `git`,
 *   `gh` and web tools are approved by the permission handler, and the
 *   limits live only as instructions in the system prompt.
 */

import type { Settings } from "./api.js";

/** Which agent-access posture a session or job runs under. */
export type AccessMode = "full" | "lockdown";

/** The posture in effect for stored settings. */
export function accessModeOf(settings: Pick<Settings, "fullAccess">): AccessMode {
  return settings.fullAccess === true ? "full" : "lockdown";
}

/**
 * The warning shown in Settings before full access can be turned on.
 * Plain words (issue #45 glossary): no spec refs, no issue numbers, no
 * internal jargon. Quoted verbatim in the implementer's report.
 */
export const FULL_ACCESS_WARNING =
  "Full access lets the review helper run commands on this machine as you: " +
  "shell commands, git, and gh with your login, and fetching pages from the web. " +
  "The limits in the review instructions are requests the helper is asked to follow. " +
  "They are not enforced, and nothing here is sandboxed. " +
  "A pull request from someone you do not trust could try to talk the helper " +
  "into misusing this access. " +
  "Only turn this on for code you trust.";
