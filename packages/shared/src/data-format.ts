/**
 * Data format (#311): one integer bumped by hand in any change that
 * makes existing stored data unreadable (the no-backward-compatibility
 * rule in the working agreement — record the bump there when this value
 * changes). The service stores it in the data dir (SQLite
 * `user_version`) when it creates data. Data with no stored value, or a
 * different value, needs a reset: it is moved aside, never converted
 * and never deleted.
 *
 * Format history:
 * - 1: flat-threads shape (#273), shipped in v0.0.12.
 */
export const DATA_FORMAT = 1;

/** Stored format of a data dir: `null` when no stamp is present. */
export type DataFormatState = "none" | "match" | "mismatch";

export interface DataFormatStatus {
  state: DataFormatState;
  /** This build's format (`DATA_FORMAT`). */
  expected: number;
  /** Format stored in the data dir; null when absent or unstamped. */
  stored: number | null;
  /** True when the data dir holds any stored data at all. */
  hasData: boolean;
}

/** Result of comparing a target build's format against the current one. */
export type DataFormatChange = "same" | "changed" | "unknown";

/**
 * Pre-update comparison (#311): a target whose format is unreadable from
 * its package metadata is `unknown` — callers warn only on `changed`
 * and say the format could not be read otherwise.
 */
export function compareDataFormat(
  current: number,
  target: number | null | undefined,
): DataFormatChange {
  if (target === null || target === undefined || !Number.isInteger(target)) return "unknown";
  return target === current ? "same" : "changed";
}

/** Plain-words pre-update warning for `compareDataFormat === "changed"`. */
export function dataFormatResetWarning(current: number, target: number): string {
  return (
    `This update changes the data format (${current} → ${target}) and cannot read your ` +
    `existing reviews. Your data will need a reset before the new build can start; ` +
    `unposted Outbox drafts will be lost unless you export them first.`
  );
}
