/**
 * Minimal `node:sqlite` wrapper shared by the store.
 *
 * Loaded via `process.getBuiltinModule` instead of a static import:
 * vitest's transform pipeline does not recognize the `node:sqlite`
 * builtin and fails to resolve it, while plain-node behavior is
 * identical. Requires Node 22.5+.
 */
import type { DatabaseSync } from "node:sqlite";

const sqlite: typeof import("node:sqlite") = process.getBuiltinModule("node:sqlite");

export type { DatabaseSync };

export function openDatabase(file: string): DatabaseSync {
  return new sqlite.DatabaseSync(file);
}

/** Run a function inside a transaction (savepoint-based: safely nestable). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("SAVEPOINT unvibe_txn");
  try {
    const out = fn();
    db.exec("RELEASE unvibe_txn");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK TO unvibe_txn");
      db.exec("RELEASE unvibe_txn");
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}
