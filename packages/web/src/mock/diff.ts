/**
 * Mock diff fixture: the real urllib3/urllib3#5020 diff embedded in
 * `prototype.html` (`<script id="diffs">`, see `rawDiffs.ts`), built into
 * snapshot `ReviewFile`s through the **shared ingest pipeline**
 * (`parseUnifiedDiff` → `buildReviewFiles` in `@unvibe/shared`) — the same
 * functions the service's ingest uses, so the fixture is exactly what
 * ingest would produce for that diff (file keys, categories, hashes,
 * `hiddenReason`, file flags).
 */
import type { ReviewFile } from "@unvibe/shared";
import { buildReviewFiles, parseUnifiedDiff } from "@unvibe/shared";
import { RAW_DIFFS } from "./rawDiffs.js";

/** The fixture files, in prototype order, keyed as ingest keys them. */
export const MOCK_FILES: ReviewFile[] = buildReviewFiles(
  RAW_DIFFS.flatMap((f) => parseUnifiedDiff(f.diff)),
);

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const LOG = "changelog-1362.bugfix.rst";

/** Canned agent hunk summaries (prototype `HSUM`), keyed `fileKey:index`. */
export const HUNK_SUMMARIES: Record<string, string> = {
  [`${CONN}:0`]:
    "Adds `_OBSOLETE_FOLD_RE` and two helpers. `_normalize_header_value` turns each fold into one space, with a fast path for values without CRLF. `_normalize_header_values` applies it to every header and, if anything changed, rewrites the original `HTTPMessage` in place, keeping order and duplicates.",
  [`${CONN}:1`]:
    "`getresponse()` now builds `HTTPHeaderDict` from the normalized header list instead of the raw `HTTPMessage` items. This is the only call site.",
  [`${TCONN}:0`]: "Imports `HTTPMessage` for the new unit test.",
  [`${TCONN}:1`]: "Imports the two new helpers.",
  [`${TCONN}:2`]:
    "Unit tests: the value helper on four inputs (including two adjacent folds), and the message helper preserving order, duplicates, payload, defects and policy.",
  [`${TSOCK}:0`]: "Imports `HTTPResponse` for an isinstance check.",
  [`${TSOCK}:1`]:
    "Socket-level test: a real response with folded `Set-Cookie` and every SP/HTAB combination around CRLF, checked through both `r.headers` and the original message.",
  [`${LOG}:0`]: "Changelog entry for the fix.",
};

/**
 * One-line "why it's skippable" copy for the hidden hunks (prototype
 * `BRIEF`; M2's hunk pass will produce these per hunk with reasons).
 */
export const HUNK_BRIEFS: Record<string, string> = {
  [`${TCONN}:0`]: "Imports `HTTPMessage` for the new unit test.",
  [`${TCONN}:1`]: "Imports the two new helpers for testing.",
  [`${TSOCK}:0`]: "Imports `HTTPResponse` for an isinstance check.",
  [`${LOG}:0`]: "Changelog entry describing the fix; no code.",
};
