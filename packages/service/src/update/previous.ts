/**
 * Previous-build picking (#311 go-back): the update helper records the
 * channel it switched from in the switch outcome. That record — and
 * only that record — names the build that can read the stored data
 * after a format-changing update. A rolled-back or same-channel
 * outcome, or one for a different current build, names nothing.
 */
import type { DataFormatStatus, SwitchOutcome } from "@unvibe/shared";

export interface PreviousBuild {
  ref: string;
  version: string | null;
}

export function pickPreviousBuild(input: {
  outcome: SwitchOutcome | null;
  /** Channel of the currently installed build; null when unknown (the outcome is then taken as-is). */
  currentChannel: string | null;
}): PreviousBuild | null {
  const o = input.outcome;
  if (!o || o.status !== "ok") return null;
  if (o.from === o.to) return null;
  if (input.currentChannel !== null && o.to !== input.currentChannel) return null;
  return { ref: o.from, version: o.fromVersion ?? null };
}

/** Last release known to write each stored format (the unstamped era is v0.0.12, format 1). */
const FORMAT_ERA_TAG: Record<number, string> = { 1: "v0.0.12" };

/**
 * Copyable go-back command: the recorded previous channel when known,
 * else the npm install line for the stored format's era when that era
 * is known, else the generic channel form.
 */
export function goBackCommand(previous: PreviousBuild | null, status: Pick<DataFormatStatus, "stored">): string {
  if (previous) return `unvibe update ${previous.ref}`;
  const era = status.stored === null ? FORMAT_ERA_TAG[1] : FORMAT_ERA_TAG[status.stored];
  if (era) return `npm install -g github:indigoviolet/unvibe#${era}`;
  return "unvibe update <channel>";
}
