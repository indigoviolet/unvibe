/**
 * Host/Origin gate tests (DNS-rebinding + cross-site WebSocket defense).
 *
 * Pure helper cases plus integration through the real Fastify app: a
 * request with a non-loopback Host or Origin must be rejected before any
 * handler (and before auth is even consulted), while normal loopback traffic
 * — including host-less non-browser clients — keeps working.
 */
import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isLoopbackHost } from "../src/security/host.js";
import { createApp } from "../src/server.js";

describe("isLoopbackHost", () => {
  it("accepts loopback names with or without port", () => {
    for (const h of ["127.0.0.1", "127.0.0.1:4517", "localhost", "localhost:80", "::1", "[::1]:4517", "::ffff:127.0.0.1"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  it("rejects attacker hosts and missing headers", () => {
    for (const h of ["evil.com", "attacker.com:4517", "127.0.0.1.evil.com", "0.0.0.0", "", undefined]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });
});

describe("isAllowedOrigin", () => {
  it("allows absent origins (non-browser clients) and loopback origins", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4517")).toBe(true);
    expect(isAllowedOrigin("http://localhost:4517/")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:4517/")).toBe(true);
  });
  it("rejects cross-site and non-http origins", () => {
    for (const o of ["http://evil.com", "https://evil.com/", "http://127.0.0.1.evil.com/", "null", "file://x"]) {
      expect(isAllowedOrigin(o), o).toBe(false);
    }
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
});
