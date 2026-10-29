/**
 * Data-format routes (#311):
 * - `GET /api/data-format` — stored format vs this build's, the
 *   read-only Outbox draft count, and the previous build recorded by
 *   the update helper (for "Go back to <version>").
 * - `GET /api/data-format/outbox` — combined Outbox export over every
 *   review (the notice's Export button; reuses #223's builder). On a
 *   mismatch the stored DB is read read-only — never written.
 * - `POST /api/data-format/reset` — move the data dir aside (never
 *   delete) and restart fresh via `deps.onDataFormatReset`. Only valid
 *   on a mismatch; 409 otherwise.
 * - `POST /api/data-format/go-back` — switch back to the previous
 *   build through the existing update path (pending switch + detached
 *   helper + shutdown; the data is untouched). 409 with the terminal
 *   command when the previous build or the installed channel is
 *   unknown.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  DataFormatGoBackResponse,
  DataFormatResetResponse,
  DataFormatStatusResponse,
  OutboxResponse,
} from "@unvibe/shared";
import {
  buildCombinedOutboxExport,
  checkDataFormat,
  exportOutboxFromDataDir,
  moveDataAside,
} from "../data-format.js";
import { tokenFilePath } from "../auth.js";
import { loadConfig } from "../config.js";
import { resolveBuildInfo } from "../update/build-info.js";
import type { HelperArgs } from "../update/helper.js";
import { goBackCommand, pickPreviousBuild } from "../update/previous.js";
import {
  clearPendingSwitch,
  readPendingSwitch,
  readSwitchOutcome,
  updateDir,
  writePendingSwitch,
} from "../update/state.js";
import { currentUid, isLoginManaged, loginUnitPath } from "../update/service-manager.js";
import os from "node:os";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export async function registerDataFormat(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  function status(): DataFormatStatusResponse {
    const s = checkDataFormat(ctx.dataDir);
    const outboxCount =
      s.state === "mismatch" ? exportOutboxFromDataDir(ctx.dataDir).count : buildCombinedOutboxExport(ctx.db).count;
    const build = resolveBuildInfo({
      dataDir: ctx.dataDir,
      serviceScriptPath: process.argv[1],
      serviceVersion: deps.serviceVersion ?? "0.0.1",
    });
    const previous = pickPreviousBuild({
      outcome: readSwitchOutcome(ctx.dataDir),
      currentChannel: build?.channel ?? null,
    });
    return {
      ...s,
      outboxCount,
      previousRef: previous?.ref ?? null,
      previousVersion: previous?.version ?? null,
      goBackCommand: goBackCommand(previous, s),
    };
  }

  app.get("/api/data-format", async (): Promise<DataFormatStatusResponse> => status());

  app.get("/api/data-format/outbox", async (): Promise<OutboxResponse> => {
    const s = checkDataFormat(ctx.dataDir);
    // Blocked (mismatch): the app context sits on an in-memory DB and the
    // stored DB must not be touched — read it read-only from disk.
    if (s.state === "mismatch") return exportOutboxFromDataDir(ctx.dataDir);
    return buildCombinedOutboxExport(ctx.db);
  });

  app.post("/api/data-format/reset", async (_req, reply) => {
    const s = checkDataFormat(ctx.dataDir);
    if (s.state !== "mismatch") {
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

  app.post("/api/data-format/go-back", async (_req, reply) => {
    const s = status();
    if (s.state !== "mismatch") {
      return reply.code(409).send({ error: "your data already matches this version, so there is nothing to go back from" });
    }
    const hooks = deps.updateHooks;
    if (!hooks) return reply.code(501).send({ error: "not available in this build" });
    const build = resolveBuildInfo({
      dataDir: ctx.dataDir,
      serviceScriptPath: process.argv[1],
      serviceVersion: deps.serviceVersion ?? "0.0.1",
    });
    const previous = pickPreviousBuild({
      outcome: readSwitchOutcome(ctx.dataDir),
      currentChannel: build?.channel ?? null,
    });
    if (!previous || !build?.channel) {
      return reply.code(409).send({
        error:
          `the previous version isn't known to this install, so go back from a terminal instead: ` +
          `${s.goBackCommand} — then run \`unvibe start\`. Your data is untouched either way.`,
      });
    }
    if (readPendingSwitch(ctx.dataDir)) {
      return reply.code(409).send({ error: "a switch is already in progress; wait for it to finish" });
    }
    const from = build.channel;
    const now = new Date().toISOString();
    writePendingSwitch(ctx.dataDir, { from, to: previous.ref, startedAt: now });
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: "couldn't work out where Unvibe is installed, so it can't switch back — use the terminal command instead" });
    }
    let port = loadConfig().port;
    try {
      const addr = app.server.address();
      if (addr && typeof addr === "object" && typeof addr.port === "number") port = addr.port;
    } catch {
      // Keep the config port.
    }
    const args: HelperArgs = {
      from,
      to: previous.ref,
      targetVersion: previous.version,
      fromVersion: build.version,
      port,
      dataDir: ctx.dataDir,
      servicePid: process.pid,
      exitWaitMs: 30_000,
      healthTimeoutMs: 120_000,
      pollIntervalMs: 500,
      stopWaitMs: 10_000,
      logPath: path.join(updateDir(ctx.dataDir), `switch-${Date.now()}.log`),
      scriptPath,
      serviceVersion: deps.serviceVersion ?? "0.0.1",
      effectivePath: process.env.PATH ?? "",
      managed: isLoginManaged(deps.loginHome?.homeDir ?? os.homedir(), deps.loginHome?.platform ?? process.platform),
      loginUnitPath: loginUnitPath(deps.loginHome?.homeDir ?? os.homedir(), deps.loginHome?.platform ?? process.platform),
      loginUid: currentUid(),
      // The user chose this switch knowing the formats differ.
      acceptDataReset: true,
    };
    const argsFile = path.join(updateDir(ctx.dataDir), `helper-args-${Date.now()}.json`);
    try {
      fs.mkdirSync(updateDir(ctx.dataDir), { recursive: true });
      fs.writeFileSync(argsFile, JSON.stringify(args, null, 2) + "\n");
      await hooks.spawnHelper(argsFile);
    } catch (err) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: `couldn't start the switch back: ${(err as Error).message}` });
    }
    const res: DataFormatGoBackResponse = { from, to: previous.ref };
    void reply.code(202).send(res);
    setTimeout(() => {
      try {
        hooks.requestShutdown();
      } catch {
        // The helper aborts safely if this process has not exited.
      }
    }, hooks.shutdownDelayMs ?? 500);
    return undefined;
  });
}
