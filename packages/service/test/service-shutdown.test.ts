/**
 * Bounded, ordered service shutdown (issues #30, #36 follow-up).
 *
 * - Phases run in an explicit order (DB last, telemetry last), not in
 *   hook-registration order.
 * - Every phase is bounded: a hanging phase is skipped, never waited on.
 * - The whole run has a hard deadline: it resolves instead of hanging.
 * - The switch helper's exit wait comfortably exceeds the deadline.
 * - Live regression: a deaf WebSocket (never answers the close
 *   handshake) plus a held-open MCP SSE stream do not block the
 *   production shutdown phases — the user's `did not exit within 30000ms`
 *   failure.
 */
import type { AddressInfo } from "node:net";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  shutdownService,
  SHUTDOWN_DEADLINE_MS,
  type ServiceShutdownSteps,
} from "../src/lifecycle/service-shutdown.js";
import { UPDATE_EXIT_WAIT_MS } from "../src/routes/update.js";
import { buildShutdownSteps } from "../src/serve.js";
import { createApp } from "../src/server.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";

function recording(): { steps: ServiceShutdownSteps; order: string[] } {
  const order: string[] = [];
  const rec = (name: string) => () => {
    order.push(name);
  };
  return {
    order,
    steps: {
      abortJobs: rec("abortJobs"),
      disposeAgents: rec("disposeAgents"),
      closeRealtime: rec("closeRealtime"),
      closeHttp: rec("closeHttp"),
      closeDb: rec("closeDb"),
      flushTelemetry: rec("flushTelemetry"),
    },
  };
}

const never = (): Promise<never> => new Promise<never>(() => {});

describe("shutdownService", () => {
  it("runs phases in order with the DB last and telemetry last", async () => {
    const { steps, order } = recording();
    const report = await shutdownService(steps);
    expect(order).toEqual([
      "abortJobs",
      "disposeAgents",
      "closeRealtime",
      "closeHttp",
      "closeDb",
      "flushTelemetry",
    ]);
    expect(report.ok).toBe(true);
    expect(report.timedOut).toEqual([]);
  });

  it("a throwing phase never blocks the rest", async () => {
    const { steps, order } = recording();
    const failing: ServiceShutdownSteps = {
      ...steps,
      closeHttp: () => {
        order.push("closeHttp");
        throw new Error("boom");
      },
    };
    const report = await shutdownService(failing);
    expect(order).toEqual([
      "abortJobs",
      "disposeAgents",
      "closeRealtime",
      "closeHttp",
      "closeDb",
      "flushTelemetry",
    ]);
    expect(report.ok).toBe(true);
  });

  it("a hanging phase is skipped within its bound and the rest still run", async () => {
    const { steps, order } = recording();
    const hanging: ServiceShutdownSteps = { ...steps, abortJobs: never };
    const t0 = Date.now();
    const report = await shutdownService(hanging, { stepMs: 30, totalMs: 1000 });
    const elapsed = Date.now() - t0;
    expect(report.ok).toBe(false);
    expect(report.timedOut).toEqual(["abortJobs"]);
    expect(order).toEqual(["disposeAgents", "closeRealtime", "closeHttp", "closeDb", "flushTelemetry"]);
    expect(elapsed).toBeLessThan(1000);
  });

  it("an all-hung run resolves on the total deadline instead of hanging", async () => {
    const hung: ServiceShutdownSteps = {
      abortJobs: never,
      disposeAgents: never,
      closeRealtime: never,
      closeHttp: never,
      closeDb: never,
      flushTelemetry: never,
    };
    const t0 = Date.now();
    const report = await shutdownService(hung, { stepMs: 5000, totalMs: 100 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(report.ok).toBe(false);
    expect(report.timedOut).toContain("total");
  });

  it("the helper exit wait comfortably exceeds the shutdown deadline", async () => {
    // The helper only reports a stuck service when the machine itself is
    // wedged: a bounded shutdown always finishes first.
    expect(UPDATE_EXIT_WAIT_MS).toBeGreaterThanOrEqual(SHUTDOWN_DEADLINE_MS * 2);
  });
});

describe("production shutdown phases with stuck connections", () => {
  it(
    "a deaf websocket plus a held MCP stream do not block shutdown",
    { timeout: 30000 },
    async () => {
      const db = openDatabase(":memory:");
      migrate(db);
      const created = await createApp("shutdown-test-token", {
        db,
        lifecycle: { idleMs: 0 },
      });
      await created.app.listen({ host: "127.0.0.1", port: 0 });
      const port = (created.app.server.address() as AddressInfo).port;
      let closed = false;
      try {
        // Deaf WebSocket: manual upgrade, then never answers close/ping.
        const deaf = await openDeafSocket(port);
        let deafClosed = false;
        deaf.on("close", () => {
          deafClosed = true;
        });
        // Held MCP SSE stream: GET opens a standalone stream that never ends.
        const issued = created.ctx.mcp.issueSession("r1", "sess-1", "session");
        const held = http.get(
          { host: "127.0.0.1", port, path: issued.path, headers: { accept: "text/event-stream" } },
          (res) => {
            res.resume();
          },
        );
        let streamClosed = false;
        held.on("close", () => {
          streamClosed = true;
        });
        await new Promise((r) => setTimeout(r, 300));

        const t0 = Date.now();
        const report = await shutdownService(buildShutdownSteps(created, db, null), {
          stepMs: 3000,
          totalMs: 12000,
        });
        const elapsed = Date.now() - t0;
        expect(report.ok).toBe(true);
        expect(report.timedOut).toEqual([]);
        expect(elapsed).toBeLessThan(12000);
        // The stuck peers were dropped server-side.
        await new Promise((r) => setTimeout(r, 300));
        expect(deafClosed).toBe(true);
        expect(streamClosed).toBe(true);
        held.destroy();
        closed = true;
      } finally {
        if (!closed) {
          await created.app.close().catch(() => {});
          try {
            db.close();
          } catch {
            // Already closed by the phases under test.
          }
        }
      }
    },
  );
});

/** Raw socket: WS upgrade, then deaf (never answers close/ping). */
function openDeafSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `GET /api/events?review=global&token=shutdown-test-token HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.includes("101 Switching Protocols")) {
        sock.off("data", onData);
        // Deaf from here on: never write back.
        sock.on("data", () => {});
        resolve(sock);
      }
    };
    sock.on("data", onData);
    sock.on("error", reject);
    setTimeout(() => reject(new Error("no WS upgrade")), 8000);
  });
}
