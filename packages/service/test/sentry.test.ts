/**
 * Dev-only Sentry reporting (issue #29): off without a DSN, never loads the
 * SDK in that case, and `reportError` is a safe no-op until it is on.
 */
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server.js";
import { initSentry, reportError, type SentrySdk } from "../src/telemetry/sentry.js";

function fakeSdk(): SentrySdk & { init: ReturnType<typeof vi.fn>; captureException: ReturnType<typeof vi.fn> } {
  return { init: vi.fn(), captureException: vi.fn(), close: vi.fn(async () => true) };
}

describe("sentry (dev-only error reporting)", () => {
  it("stays off and never loads the SDK without SENTRY_DSN_SERVICE", async () => {
    const load = vi.fn(async () => fakeSdk());
    expect(await initSentry({}, load)).toBeNull();
    expect(await initSentry({ SENTRY_DSN_SERVICE: "  " }, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(() => reportError(new Error("ignored"))).not.toThrow();
  });

  it("stays off when the SDK is not installed (release install)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reporter = await initSentry({ SENTRY_DSN_SERVICE: "https://key@sentry.invalid/1" }, async () => {
        throw new Error("Cannot find package '@sentry/node'");
      });
      expect(reporter).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("inits with the DSN, reports errors, and stops reporting after close", async () => {
    const sdk = fakeSdk();
    const reporter = await initSentry({ SENTRY_DSN_SERVICE: "https://key@sentry.invalid/1" }, async () => sdk);
    expect(sdk.init).toHaveBeenCalledWith({ dsn: "https://key@sentry.invalid/1", environment: "development" });
    const err = new Error("boom");
    reportError(err, { jobId: "j1" });
    expect(sdk.captureException).toHaveBeenCalledWith(err, { extra: { jobId: "j1" } });

    await reporter!.close();
    expect(sdk.close).toHaveBeenCalledOnce();
    reportError(new Error("after close"));
    expect(sdk.captureException).toHaveBeenCalledOnce();
  });

  it("reportError swallows SDK failures", async () => {
    const sdk = fakeSdk();
    sdk.captureException.mockImplementation(() => {
      throw new Error("sdk broke");
    });
    const reporter = await initSentry({ SENTRY_DSN_SERVICE: "https://key@sentry.invalid/1" }, async () => sdk);
    expect(() => reportError(new Error("boom"))).not.toThrow();
    await reporter!.close();
  });

  it("reports route faults (5xx) but not 4xx replies", async () => {
    const sdk = fakeSdk();
    const reporter = await initSentry({ SENTRY_DSN_SERVICE: "https://key@sentry.invalid/1" }, async () => sdk);
    const { app } = await createApp("tok", { autoPipeline: false });
    try {
      const fault = new Error("route fault");
      app.get("/api/test-fault", async () => {
        throw fault;
      });
      app.get("/api/test-bad-request", async () => {
        throw Object.assign(new Error("bad input"), { statusCode: 400 });
      });
      const headers = { authorization: "Bearer tok" };
      expect((await app.inject({ method: "GET", url: "/api/test-fault", headers })).statusCode).toBe(500);
      expect((await app.inject({ method: "GET", url: "/api/test-bad-request", headers })).statusCode).toBe(400);
      expect(sdk.captureException).toHaveBeenCalledOnce();
      expect(sdk.captureException).toHaveBeenCalledWith(fault, {
        extra: { method: "GET", route: "/api/test-fault" },
      });
    } finally {
      await app.close();
      await reporter!.close();
    }
  });
});
