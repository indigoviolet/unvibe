/**
 * SQLite tracing (issue #356): one `sqlite <op>` span per statement
 * execution, by operation name only (`SELECT reviews`, `INSERT jobs`).
 * Bound values never reach a span — only the timing and the schema's own
 * table names (safe tokens). Wiring lives in `store/db.ts`
 * (`TracedDatabaseSync`); when recording is off every call is a direct
 * passthrough with no span, no allocation beyond the prepare itself.
 */
import { getActiveTracer, traceSpan } from "./tracing.js";
import { isSafeToken } from "./scrub.js";

const OP = /^\s*(select|insert|update|delete|pragma|create|drop|with|savepoint|release|rollback|begin|commit)\b/i;
const TABLE_AFTER = /\b(?:from|into|update)\s+([A-Za-z_][A-Za-z0-9_]*)/i;

/** Operation + table from SQL text; never throws, never keeps the text. */
export function parseSqlOperation(sql: string): { op: string; table?: string } {
  const opMatch = OP.exec(sql);
  const op = opMatch?.[1]?.toLowerCase() ?? "other";
  const tableMatch = TABLE_AFTER.exec(sql);
  const table = tableMatch?.[1] !== undefined && isSafeToken(tableMatch[1]) ? tableMatch[1] : undefined;
  return table === undefined ? { op } : { op, table };
}

/** Wrap a prepared statement's executing methods with spans. */
export function traceStatement<T extends object>(stmt: T, sql: string): T {
  if (!getActiveTracer()) return stmt;
  const { op, table } = parseSqlOperation(sql);
  const name = `sqlite ${op}`;
  const attrs: Record<string, string> = table !== undefined ? { "sqlite.table": table } : {};
  return new Proxy(stmt, {
    get(target, prop) {
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      if (
        (prop === "get" || prop === "all" || prop === "run" || prop === "iterate") &&
        typeof value === "function"
      ) {
        const fn = value as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const span = traceSpan(name, attrs);
          try {
            return fn.apply(target, args);
          } finally {
            span.end();
          }
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}
