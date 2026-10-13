/**
 * Loopback dual-bind (issue #108): `listen()` answers however the browser
 * resolves `unvibe.localhost` — `::1` as well as `127.0.0.1` — over HTTP
 * and WebSocket, while the bind stays loopback-only and no configuration
 * can move it to a routable address.
 *
 * Real sockets on ephemeral ports (never 4517, never the real data dir).
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { createApp, extraLoopbackServer, listen } from "../src/server.js";

function sockAddr(s: unknown): AddressInfo {
  const addr = (s as { address(): unknown }).address();
  if (typeof addr === "object" && addr !== null) return addr as AddressInfo;
  throw new Error("server is not listening on a socket address");
}

describe("listen() loopback dual-bind", () => {
  it("answers on 127.0.0.1, ::1 and unvibe.localhost (same port), loopback only", async () => {
    const { app } = await createApp("tok", {});
    try {
      const url = await listen(app, { host: "127.0.0.1", port: 0, dataDir: "", idleMs: 0 });
      expect(url).toMatch(/^http:\/\/unvibe\.localhost:\d+$/);
      const port = Number(new URL(url).port);
      expect(port).toBeGreaterThan(0);

      // Both sockets bound, same port, loopback addresses only.
      const v4 = sockAddr(app.server);
      expect(v4.address).toBe("127.0.0.1");
      expect(v4.port).toBe(port);
      const v6 = extraLoopbackServer(app);
      expect(v6).toBeDefined();
      const v6addr = sockAddr(v6);
      expect(v6addr.address).toBe("::1");
      expect(v6addr.port).toBe(port);

      for (const base of [`http://127.0.0.1:${port}`, `http://[::1]:${port}`, `http://unvibe.localhost:${port}`]) {
        const res = await fetch(`${base}/api/health`);
        expect(res.status, base).toBe(200);
        expect(await res.json(), base).toMatchObject({ ok: true });
      }
    } finally {
      await app.close();
      expect(extraLoopbackServer(app)).toBeUndefined();
    }
  });

  it("serves WebSocket upgrades on ::1 too", async () => {
    const { app } = await createApp("tok", {});
    try {
      const url = await listen(app, { host: "127.0.0.1", port: 0, dataDir: "", idleMs: 0 });
      const port = Number(new URL(url).port);
      const socket = new WebSocket(`ws://[::1]:${port}/api/events?review=rv_x&token=tok`);
      const outcome = await new Promise<string>((resolve) => {
        socket.on("open", () => resolve("opened"));
        socket.on("error", (err) => resolve(`error: ${err.message}`));
        setTimeout(() => resolve("timeout"), 5000);
      });
      expect(outcome).toBe("opened");
      socket.close();
    } finally {
      await app.close();
    }
  });
});

describe("bind configuration", () => {
  it("has no host knob: host-like env never moves the bind off loopback", () => {
    const config = loadConfig({
      UNVIBE_HOST: "0.0.0.0",
      UNVIBE_BIND: "0.0.0.0",
      UNVIBE_LISTEN: "0.0.0.0",
      UNVIBE_HOSTNAME: "evil.example",
    } as NodeJS.ProcessEnv);
    expect(config.host).toBe("127.0.0.1");
    // The only bind inputs are the port and data dir.
    expect(loadConfig({ UNVIBE_PORT: "4599" } as NodeJS.ProcessEnv).port).toBe(4599);
  });
});
