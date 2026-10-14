/**
 * System-prompt variants for issue #160 (full-access opt-in).
 *
 * `prompts/instructions.md` carries an `{{access_policy}}` placeholder
 * where the tool-access paragraph lives. The two variants fill it:
 * - `access-lockdown`: today's read-only wording (byte-for-byte what
 *   sessions got before this change).
 * - `access-full`: the allowed/forbidden list for full-access sessions.
 *
 * One source of truth for which variant a session got: the rendered
 * system-prompt string itself (stored on the session record), the session
 * posture (`readOnly`), the base key's `access`, and the job's
 * `accessMode` stamp. A session started under one setting keeps it until
 * it ends: flipping the setting keys new bases, while live sessions and
 * conversation cards keep their old posture until they close or rebuild.
 */
import type { AccessMode } from "@unvibe/shared";
import { renderTemplate, type TemplateLibrary } from "./index.js";

function policyText(lib: TemplateLibrary, name: string): string {
  const tpl = lib.get(name);
  if (!tpl) throw new Error(`missing prompt template ${name}`);
  // Fragment files end with a newline by convention; the placeholder sits
  // mid-body, so strip it for byte-stable substitution.
  return renderTemplate(tpl, {}).trimEnd();
}

/** The `{{access_policy}}` value for a mode (the exact bytes substituted). */
export function accessPolicyText(lib: TemplateLibrary, access: AccessMode): string {
  return policyText(lib, access === "full" ? "access-full" : "access-lockdown");
}

/**
 * Render the L0 system prompt for a mode. With `lockdown` the output is
 * byte-for-byte the pre-#160 instructions render.
 */
export function renderSystemPrompt(lib: TemplateLibrary, access: AccessMode): string {
  const tpl = lib.get("instructions");
  if (!tpl) throw new Error("missing instructions template");
  return renderTemplate(tpl, { access_policy: accessPolicyText(lib, access) });
}
