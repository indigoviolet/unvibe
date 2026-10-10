/**
 * Citation validator (PRD §10): lookup interface, per-token validation,
 * and a `ReviewSnapshot` implementation.
 */
export type { HunkLocation, ReviewLookup } from "./lookup.js";
export {
  REPAIR_THRESHOLD,
  validateAnchor,
  validateReply,
  validateTarget,
} from "./validate.js";
export type {
  AnchorCheck,
  TokenReport,
  TokenStatus,
  ValidateReplyOptions,
  ValidationReport,
} from "./validate.js";
export { createSnapshotLookup } from "./snapshot.js";
export type { SnapshotLookupExtra } from "./snapshot.js";
