/**
 * Host/Origin gate tests (DNS-rebinding + cross-site WebSocket defense).
 *
 * Pure helper cases plus integration through the real Fastify app: a
 * request with a non-loopback Host or Origin must be rejected before any
 * handler (and before auth is even consulted), while normal loopback traffic
 * — including host-less non-browser clients — keeps working.
 *
 * Issue #108 adds exactly one name, `unvibe.localhost`, to the accepted
 * set. The match is exact, never a suffix or substring: every look-alike
 * below stays rejected, on HTTP and on WebSocket handshakes alike.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { hostCheckAllows, isAllowedOrigin, isLoopbackHost } from "../src/security/host.js";
import { createApp } from "../src/server.js";
import { RealCommandRunner } from "../src/exec/index.js";

describe("isLoopbackHost", () => {
  it("accepts loopback names with or without port", () => {
    for (const h of [
      "127.0.0.1",
      "127.0.0.1:4517",
      "localhost",
      "localhost:80",
      "unvibe.localhost",
      "unvibe.localhost:4517",
      "::1",
      "[::1]:4517",
      "::ffff:127.0.0.1",
    ]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  it("accepts unvibe.localhost in any case (DNS names are case-insensitive)", () => {
    for (const h of ["UNVIBE.LOCALHOST", "Unvibe.Localhost:4517", "uNvIbE.lOcAlHoSt"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  it("rejects attacker hosts and missing headers", () => {
    for (const h of ["evil.com", "attacker.com:4517", "127.0.0.1.evil.com", "0.0.0.0", "", undefined]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });
  it("rejects unvibe.localhost look-alikes: no suffix or substring match", () => {
    for (const h of [
      // Super/sub-domains around the name.
      "unvibe.localhost.evil.example",
      "evil-unvibe.localhost",
      "xunvibe.localhost",
      "unvibe.localhostjunk",
      "myunvibe.localhost",
      // Other *.localhost names are not ours.
      "evil.localhost",
      "foo.localhost",
      "localhost.localhost",
      // Trailing dot (FQDN form): not what browsers send; reject.
      "unvibe.localhost.",
      "unvibe.localhost.:4517",
      // Userinfo tricks never form a valid Host.
      "unvibe.localhost@evil.com",
      "user@unvibe.localhost:4517",
      // IPv6 literals that are not exactly the accepted forms.
      "[::ffff:7f00:1]",
      "[0:0:0:0:0:ffff:127.0.0.1]",
      "[::2]",
      // Whitespace/control smuggling.
      "unvibe.localhost evil.com",
      "unvibe.localhost\n.evil.com",
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });
});

describe("isAllowedOrigin", () => {
  it("allows absent origins (non-browser clients) and loopback origins", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4517")).toBe(true);
    expect(isAllowedOrigin("http://localhost:4517/")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:4517/")).toBe(true);
    expect(isAllowedOrigin("http://unvibe.localhost:4517")).toBe(true);
    expect(isAllowedOrigin("http://unvibe.localhost:4517/")).toBe(true);
  });
  it("rejects cross-site and non-http origins", () => {
    for (const o of ["http://evil.com", "https://evil.com/", "http://127.0.0.1.evil.com/", "null", "file://x"]) {
      expect(isAllowedOrigin(o), o).toBe(false);
    }
  });
  it("rejects unvibe.localhost look-alike origins (no suffix match)", () => {
    for (const o of [
      "http://unvibe.localhost.evil.example:4517/",
      "http://evil-unvibe.localhost:4517/",
      "http://xunvibe.localhost:4517/",
      "http://evil.localhost:4517/",
      "http://foo.localhost:4517/",
      // Userinfo: the real host is evil.com.
      "http://unvibe.localhost@evil.com/",
      "http://unvibe.localhost:4517@evil.com/",
      // Hex IPv6 for 127.0.0.1 is not the accepted literal.
      "http://[::ffff:7f00:1]:4517/",
    ]) {
      expect(isAllowedOrigin(o), o).toBe(false);
    }
  });
  it("stays port-agnostic on accepted names (decided, issue #108)", () => {
    // Pinning Origin to the service port was tried and reverted: the
    // service cannot reliably know its public port (ephemeral UNVIBE_PORT=0
    // binds, tunnels), and the pin 403s the app's own asset loads with a
    // blank page (caught by real-service.spec). The exact-name match is
    // the whole defence: no look-alike name passes on any port.
    for (const o of [
      "http://unvibe.localhost:4517",
      "http://unvibe.localhost:9999",
      "http://unvibe.localhost",
      "http://127.0.0.1:9999",
    ]) {
      expect(isAllowedOrigin(o), o).toBe(true);
    }
    // Absent origins stay allowed (non-browser clients).
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});

describe("hostCheckAllows", () => {
  it("rejects an Origin that is not an accepted name even with an accepted Host", () => {
    expect(
      hostCheckAllows({ headers: { host: "unvibe.localhost:4517", origin: "http://evil.com" } }),
    ).toEqual({ ok: false, reason: "origin is not loopback" });
    expect(
      hostCheckAllows({
        headers: { host: "unvibe.localhost:4517", origin: "http://unvibe.localhost.evil.example:4517" },
      }),
    ).toEqual({ ok: false, reason: "origin is not loopback" });
  });
  it("rejects an evil Host even with an accepted Origin", () => {
    expect(
      hostCheckAllows({ headers: { host: "evil.com", origin: "http://unvibe.localhost:4517" } }),
    ).toEqual({ ok: false, reason: "host is not loopback" });
  });
  it("rejects an absent Host", () => {
    expect(hostCheckAllows({ headers: {} })).toEqual({ ok: false, reason: "host is not loopback" });
    expect(hostCheckAllows({ headers: { host: undefined } })).toEqual({
      ok: false,
      reason: "host is not loopback",
    });
  });
});

describe("service host gate", () => {
  it("rejects non-loopback Host before auth, allows loopback traffic", async () => {
    const { app } = await createApp("tok", {});
    try {
      const evilHost = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { host: "evil.com" },
      });
      expect(evilHost.statusCode).toBe(403);

      const evilOrigin = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "http://evil.com" },
      });
      expect(evilOrigin.statusCode).toBe(403);

      // Health stays token-exempt on loopback; API still needs the token.
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      const noToken = await app.inject({ method: "GET", url: "/api/repos" });
      expect(noToken.statusCode).toBe(401);
      const authed = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { authorization: "Bearer tok" },
      });
      expect(authed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("serves unvibe.localhost like 127.0.0.1 and rejects its look-alikes", async () => {
    const { app } = await createApp("tok", {});
    try {
      // Accepted: the gate passes, auth still applies.
      const ok = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { host: "unvibe.localhost:4517", authorization: "Bearer tok" },
      });
      expect(ok.statusCode).toBe(200);
      const noToken = await app.inject({
        method: "GET",
        url: "/api/repos",
        headers: { host: "unvibe.localhost:4517" },
      });
      expect(noToken.statusCode).toBe(401);
      const sameOrigin = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { host: "unvibe.localhost:4517", origin: "http://unvibe.localhost:4517" },
      });
      expect(sameOrigin.statusCode).toBe(200);

      // Rejected: every look-alike fails before auth is consulted.
      for (const host of [
        "unvibe.localhost.evil.example",
        "evil-unvibe.localhost:4517",
        "xunvibe.localhost:4517",
        "evil.localhost:4517",
        "unvibe.localhost.:4517",
      ]) {
        const res = await app.inject({
          method: "GET",
          url: "/api/health",
          headers: { host, authorization: "Bearer tok" },
        });
        expect(res.statusCode, host).toBe(403);
      }
      for (const origin of ["http://evil.com", "http://unvibe.localhost.evil.example:4517"]) {
        const res = await app.inject({
          method: "GET",
          url: "/api/health",
          headers: { host: "unvibe.localhost:4517", origin, authorization: "Bearer tok" },
        });
        expect(res.statusCode, origin).toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it("accepts matching-name traffic on any port (the gate is name-only)", async () => {
    const { app } = await createApp("tok", {});
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { host: "unvibe.localhost:9999", origin: "http://unvibe.localhost:9999" },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("applies the same gate to WebSocket upgrades", async () => {
    const { app } = await createApp("tok", { runner: new RealCommandRunner() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as AddressInfo).port;
    const url = `ws://unvibe.localhost:${port}/api/events?review=rv_missing&token=tok`;
    try {
      // Same-origin handshake on the new name: the gate passes and the
      // upgrade completes (the route subscribes any review id to the bus).
      const sameOrigin = new WebSocket(url, { origin: `http://unvibe.localhost:${port}` });
      const sameOutcome = await new Promise<string>((resolve) => {
        sameOrigin.on("open", () => resolve("opened"));
        sameOrigin.on("unexpected-response", (_req, res) =>
          resolve(`rejected: ${res.statusCode}`),
        );
        sameOrigin.on("error", (err) => resolve(`error: ${err.message}`));
        setTimeout(() => resolve("timeout"), 5000);
      });
      expect(sameOutcome).toBe("opened");
      sameOrigin.close();

      // Cross-site handshake: rejected by the gate before auth.
      const evilOrigin = new WebSocket(url, { origin: "http://evil.com" });
      const evilOutcome = await new Promise<string>((resolve) => {
        evilOrigin.on("open", () => resolve("opened"));
        evilOrigin.on("unexpected-response", (_req, res) =>
          resolve(`rejected: ${res.statusCode}`),
        );
        evilOrigin.on("error", (err) => resolve(`error: ${err.message}`));
        setTimeout(() => resolve("timeout"), 5000);
      });
      expect(evilOutcome).toMatch(/rejected: 403|error/);
      expect(evilOutcome).not.toBe("opened");
      evilOrigin.close();
    } finally {
      await app.close();
    }
  });
});
