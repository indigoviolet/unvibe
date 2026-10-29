/**
 * Data-format routes (#311):
 * - `GET /api/data-format` — stored format vs this build's.
 * - `GET /api/data-format/outbox` — combined Outbox export over every
 *   review (the notice's "Export Outbox first"; reuses #223's builder).
 *   On a mismatch the stored DB is read read-only — never written.
 * - `POST /api/data-format/reset` — move the data dir aside (never
 *   delete) and restart fresh via `deps.onDataFormatReset`. Only valid
 *   on a mismatch; 409 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { DataFormatResetResponse, DataFormatStatusResponse, OutboxResponse } from "@unvibe/shared";
import {
  buildCombinedOutboxExport,
  checkDataFormat,
  exportOutboxFromDataDir,
  moveDataAside,
} from "../data-format.js";
import { tokenFilePath } from "../auth.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export async function registerDataFormat(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  app.get("/api/data-format", async (): Promise<DataFormatStatusResponse> => {
    return checkDataFormat(ctx.dataDir);
  });

  app.get("/api/data-format/outbox", async (): Promise<OutboxResponse> => {
    const status = checkDataFormat(ctx.dataDir);
    // Blocked (mismatch): the app context sits on an in-memory DB and the
    // stored DB must not be touched — read it read-only from disk.
    if (status.state === "mismatch") return exportOutboxFromDataDir(ctx.dataDir);
    return buildCombinedOutboxExport(ctx.db);
  });

  app.post("/api/data-format/reset", async (_req, reply) => {
    const status = checkDataFormat(ctx.dataDir);
    if (status.state !== "mismatch") {
      return reply
        .code(409)
        .send({ error: "your data already matches this version, so there is nothing to reset" });
    }
    // Keep the browser connected across the restart: the token moves
    // back into the fresh dir (the old copy stays in the moved-aside dir).
    let token: string | null = null;
    try {
      token = fs.readFileSync(tokenFilePath(ctx.dataDir), "utf8");
    } catch {
      token = null;
    }
    let movedTo: string;
    try {
      movedTo = moveDataAside(ctx.dataDir);
    } catch (err) {
      return reply.code(500).send({ error: `couldn't move your data aside: ${(err as Error).message}` });
    }
    if (token) {
      try {
        fs.writeFileSync(path.join(ctx.dataDir, "token"), token, { mode: 0o600 });
      } catch {
        // The next start creates a fresh token; `unvibe open` reconnects.
      }
    }
    const res: DataFormatResetResponse = { ok: true, movedTo };
    void reply.send(res);
    if (deps.onDataFormatReset) {
      setTimeout(() => {
        try {
          deps.onDataFormatReset?.();
        } catch {
          // The data is already moved; a failed restart still starts fresh next time.
        }
      }, 100);
    }
    return undefined;
  });
}
