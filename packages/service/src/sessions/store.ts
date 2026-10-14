/**
 * Session persistence for the session manager.
 *
 * One lazily-created `sessions` table (`CREATE TABLE IF NOT EXISTS`), so
 * this never conflicts with review-state migrations. After a restart every
 * record loads as closed; sessions reopen lazily via `load()` (PRD §12,
 * §16).
 */
import type { Session } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";
import type { BaseKey } from "./manager.js";

export interface PersistedBase {
  key: BaseKey;
  session: Session;
  /** Build params needed to restart the session (cwd, system prompt, posture, MCP, effort). */
  build: { cwd: string; systemPrompt: string; readOnly: boolean; mcpServers: unknown[]; effort: string };
  pack: string;
  logSeq: number;
  live: boolean;
  updatedAt: number;
}

export interface PersistedConversation {
  session: Session;
  baseKey: string;
  viaFork: boolean;
  lastSeenSeq: number;
  live: boolean;
  updatedAt: number;
  /** Issue #160: posture the session started with; absent on older rows. */
  readOnly?: boolean;
}

export class SessionStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         session_id TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         base_key TEXT NOT NULL DEFAULT '',
         data TEXT NOT NULL DEFAULT '{}'
       )`,
    );
  }

  saveBase(record: PersistedBase): void {
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, kind, base_key, data) VALUES (?, 'base', ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET kind = excluded.kind, base_key = excluded.base_key, data = excluded.data`,
      )
      .run(record.session.id, JSON.stringify(record.key), JSON.stringify(record));
  }

  saveConversation(record: PersistedConversation): void {
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, kind, base_key, data) VALUES (?, 'conv', ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET kind = excluded.kind, base_key = excluded.base_key, data = excluded.data`,
      )
      .run(record.session.id, record.baseKey, JSON.stringify(record));
  }

  remove(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  removeBase(key: string): void {
    this.db.prepare("DELETE FROM sessions WHERE kind = 'base' AND base_key = ?").run(key);
  }

  /** Load everything; all records come back closed (fresh process). */
  loadAll(): { bases: PersistedBase[]; conversations: PersistedConversation[] } {
    const rows = this.db.prepare("SELECT kind, data FROM sessions").all() as {
      kind: string;
      data: string;
    }[];
    const bases: PersistedBase[] = [];
    const conversations: PersistedConversation[] = [];
    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (row.kind === "base") bases.push({ ...data, live: false });
      else conversations.push({ ...data, live: false });
    }
    return { bases, conversations };
  }
}
