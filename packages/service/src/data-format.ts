/**
 * Data-format gate (#311): the service stores `DATA_FORMAT`
 * (`@unvibe/shared`) as SQLite `user_version` in `unvibe.db` when it
 * creates a data dir. On start, a stored value that differs — or data
 * with no stamp at all — is a mismatch: the service does not touch the
 * data, the app shows a full-page reset notice, and Reset moves the
 * whole data dir aside (never deletes it) and starts fresh. No
 * conversion is ever attempted.
 */
import fs from "node:fs";
import {
  DATA_FORMAT,
  buildOutboxExportMarkdown,
  isDefaultGuideTitle,
  isDocumentReview,
  outboxThreads,
  type DataFormatStatus,
  type ReviewSnapshot,
} from "@unvibe/shared";
import type { DatabaseSync } from "./store/db.js";
import { dbFilePath, openDatabaseReadOnly } from "./store/index.js";

export type { DataFormatStatus };

/** Files that are not user data on their own (token, lock, diagnostic probe scratch). */
const NON_DATA_ENTRIES = new Set(["token", "unvibe.lock", "tmp"]);

function dirHasData(dataDir: string): boolean {
  try {
    return fs.readdirSync(dataDir).some((e) => !NON_DATA_ENTRIES.has(e));
  } catch {
    return false;
  }
}

/**
 * Read the stored format without writing anything. The DB is opened
 * read-only; an unreadable DB counts as data with no stamp (mismatch),
 * so the reset notice — which moves data aside — is the way out.
 */
export function checkDataFormat(dataDir: string, expected: number = DATA_FORMAT): DataFormatStatus {
  const dbFile = dbFilePath(dataDir);
  let stored: number | null = null;
  let hasData = false;
  if (fs.existsSync(dbFile)) {
    try {
      const db = openDatabaseReadOnly(dbFile);
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as unknown as { name: string }[];
        hasData = tables.length > 0;
        const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
        const v = typeof row?.user_version === "number" ? row.user_version : 0;
        stored = v === 0 ? null : v;
      } finally {
        db.close();
      }
    } catch {
      hasData = true;
      stored = null;
    }
  } else {
    hasData = dirHasData(dataDir);
  }
  if (!hasData) return { state: "none", expected, stored: null, hasData: false };
  return {
    state: stored === expected ? "match" : "mismatch",
    expected,
    stored,
    hasData: true,
  };
}

/** Stamp a fresh (or matching) database with this build's format. */
export function stampDataFormat(db: DatabaseSync, format: number = DATA_FORMAT): void {
  db.exec(`PRAGMA user_version = ${Math.trunc(format)}`);
}

/** Dated sibling a data dir is moved to, e.g. `unvibe.bak-2026-10-29T12-00-00-000Z`. */
export function dataAsidePath(dataDir: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${dataDir}.bak-${stamp}`;
}

/**
 * Move the whole data dir aside (never delete) and recreate it empty.
 * Returns the destination. A second move at the same instant gets a
 * `-2`, `-3`, … suffix instead of overwriting the first copy.
 */
export function moveDataAside(dataDir: string, now: Date = new Date()): string {
  let dest = dataAsidePath(dataDir, now);
  for (let n = 2; fs.existsSync(dest); n++) dest = `${dataAsidePath(dataDir, now)}-${n}`;
  if (fs.existsSync(dataDir)) fs.renameSync(dataDir, dest);
  fs.mkdirSync(dataDir, { recursive: true });
  return dest;
}

/**
 * Combined Outbox export over every stored review snapshot (#311:
 * "Export Outbox first" before a reset). Reuses the shared per-review
 * builder (#223). Unreadable snapshots are skipped, never fatal.
 */
export function buildCombinedOutboxExport(db: DatabaseSync): { markdown: string; count: number } {
  let rows: { snapshot: string }[] = [];
  try {
    const has = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_snapshots'")
      .get();
    if (has) {
      rows = db.prepare("SELECT snapshot FROM review_snapshots ORDER BY review_id").all() as unknown as {
        snapshot: string;
      }[];
    }
  } catch {
    rows = [];
  }
  const parts: string[] = [];
  let count = 0;
  for (const row of rows) {
    try {
      const snapshot = JSON.parse(row.snapshot) as ReviewSnapshot;
      const n = outboxThreads(snapshot).length;
      if (n === 0) continue;
      const rootTitle = snapshot.pages?.find((p) => p.kind === "root")?.title;
      const title = isDocumentReview(snapshot)
        ? snapshot.document.title
        : rootTitle && !isDefaultGuideTitle(rootTitle)
          ? rootTitle
          : snapshot.review.branch || snapshot.review.id;
      parts.push(buildOutboxExportMarkdown(snapshot, { title }).trimEnd());
      count += n;
    } catch {
      // One unreadable snapshot must not lose the rest of the Outbox.
    }
  }
  const markdown =
    parts.length > 0 ? `${parts.join("\n\n")}\n` : "# Comments on your reviews\n\nNothing in the Outbox.\n";
  return { markdown, count };
}

/** Combined export read straight from a data dir's DB, opened read-only. */
export function exportOutboxFromDataDir(dataDir: string): { markdown: string; count: number } {
  const dbFile = dbFilePath(dataDir);
  if (!fs.existsSync(dbFile)) return { markdown: "# Comments on your reviews\n\nNothing in the Outbox.\n", count: 0 };
  const db = openDatabaseReadOnly(dbFile);
  try {
    return buildCombinedOutboxExport(db);
  } finally {
    db.close();
  }
}

/** `unvibe doctor` line for the format state (#311); `goBack` is the go-back command on a mismatch. */
export function dataFormatDoctorCheck(status: DataFormatStatus, goBack?: string): {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
} {
  if (status.state === "match") {
    return { name: "data format", status: "ok", detail: `format ${status.stored} matches this build (format ${status.expected})` };
  }
  if (status.state === "none") {
    return { name: "data format", status: "ok", detail: `no stored data yet; new data will be written as format ${status.expected}` };
  }
  return {
    name: "data format",
    status: "warn",
    detail:
      `stored data is format ${status.stored ?? "(unstamped, before the format stamp existed)"} but this build reads format ${status.expected}; ` +
      `the app will ask for a reset on start. Export unposted Outbox drafts first, then run \`unvibe reset-data\` (moves the data aside, never deletes it) or use Reset in the app.` +
      (goBack ? ` To go back to the previous version instead (your data stays untouched): \`${goBack}\`, then \`unvibe start\`.` : ""),
  };
}

export { DATA_FORMAT };
