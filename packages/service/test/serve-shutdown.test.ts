import { describe, expect, it } from "vitest";
import { ShutdownHooks } from "../src/lifecycle/index.js";
import { registerShutdownHooks, type ServeShutdownDeps } from "../src/serve.js";

/**
 * serve.ts shutdown order (issue #30): effective teardown must be agent
 * subprocesses and jobs first, then the HTTP server, then the DB last —
 * jobs still running during shutdown must find an open database — with
 * the Sentry flush after everything that might report errors.
 */
function fakeDeps(order: string[], opts: { sentry?: boolean; throwOn?: string } = {}): ServeShutdownDeps {
  const hook = (name: string) => () => {
    order.push(name);
    if (opts.throwOn === name) throw new Error(`${name} boom`);
  };
  return {
    sentry: opts.sentry
      ? {
          capture: () => {},
          close: async () => {
            order.push("sentry");
            if (opts.throwOn === "sentry") throw new Error("sentry boom");
          },
        }
      : null,
    disposeAgents: hook("agents"),
    shutdownJobs: hook("jobs"),
    closeApp: hook("app"),
    closeDb: hook("db"),
  };
}

describe("registerShutdownHooks", () => {
  it("tears down agents and jobs before the server and DB, Sentry last", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownHooks();
    registerShutdownHooks(shutdown, fakeDeps(order, { sentry: true }));
    await shutdown.run();
    expect(order).toEqual(["agents", "jobs", "app", "db", "sentry"]);
    // Regression pin for #30: the DB close must never move ahead of
    // jobs/agents again (a closed DB under running jobs loses writes).
    expect(order.indexOf("db")).toBeGreaterThan(order.indexOf("jobs"));
    expect(order.indexOf("db")).toBeGreaterThan(order.indexOf("agents"));
  });

  it("without Sentry the DB still closes last", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownHooks();
    registerShutdownHooks(shutdown, fakeDeps(order));
    await shutdown.run();
    expect(order).toEqual(["agents", "jobs", "app", "db"]);
  });

  it("a throwing agents hook still lets the DB close run", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownHooks();
    registerShutdownHooks(shutdown, fakeDeps(order, { sentry: true, throwOn: "agents" }));
    await shutdown.run();
    expect(order).toEqual(["agents", "jobs", "app", "db", "sentry"]);
  });

  it("a throwing jobs hook still lets the DB close run", async () => {
    const order: string[] = [];
    const shutdown = new ShutdownHooks();
    registerShutdownHooks(shutdown, fakeDeps(order, { sentry: true, throwOn: "jobs" }));
    await shutdown.run();
    expect(order).toEqual(["agents", "jobs", "app", "db", "sentry"]);
  });
});
