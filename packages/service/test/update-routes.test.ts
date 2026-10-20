/**
 * Version-picker routes (issue #36, step 2): gate off/on, busy + lease +
 * pending refusals, unknown refs, auth/host gates, and the commit path
 * (pending file, helper spawn args, shutdown trigger).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UpdateChannel, UpdateStatusResponse } from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { createApp, SERVICE_VERSION } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import { JobQueue } from "../src/jobs/queue.js";
import { FakeUpdater, type Updater } from "../src/update/updater.js";
import { readPendingSwitch, writePendingSwitch } from "../src/update/state.js";
import { UPDATE_SHUTDOWN_DELAY_MS } from "../src/routes/update.js";

const TOKEN = "update-test-token";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-update-routes-"));
}

interface Harness {
  app: Awaited<ReturnType<typeof createApp>>["app"];
  dataDir: string;
  spawned: string[];
  shutdownCalls: () => number;
  close: () => Promise<void>;
}

export interface FakeInstallSpec {
  channel: string;
  version?: string;
  commit?: string | null;
}

/**
 * Fake global install for `readInstalledBuild`: the route identifies the
 * installed channel from `process.argv[1]`, so the harness points argv at
 * a temp install tree (restored on close). Pass `install: null` to leave
 * argv alone (source-checkout shape → switch refused).
 */
function makeFakeInstall(spec: FakeInstallSpec): { scriptPath: string } {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "packages", "service", "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "unvibe",
      version: spec.version ?? "0.0.1",
      unvibe: {
        channel: spec.channel,
        ...(spec.commit ? { commit: spec.commit } : {}),
      },
    }),
  );
  const scriptPath = path.join(dir, "packages", "service", "dist", "index.js");
  fs.writeFileSync(scriptPath, "");
  return { scriptPath };
}

async function makeHarness(opts: {
  gate?: boolean;
  updater?: Updater | null;
  wrapUpdater?: (base: Updater) => Updater;
  jobs?: JobQueue;
  withLease?: boolean;
  withPending?: boolean;
  install?: FakeInstallSpec | null;
  /** Use a FakeUpdater over this harness's data dir (else the real backend). */
  fakeUpdater?: boolean;
} = {}): Promise<Harness> {
  const db = openDatabase(":memory:");
  migrate(db);
  const dataDir = tempDir();
  const settings = new SettingsStore(db);
  if (opts.gate) settings.update({ versionPickerEnabled: true });
  const savedArgv1 = process.argv[1];
  if (opts.install !== null) {
    const spec = opts.install ?? { channel: "release", version: "0.0.1" };
    process.argv[1] = makeFakeInstall(spec).scriptPath;
  }
  if (opts.withLease) {
    db.prepare("INSERT INTO submit_leases (review_id, started_at, commit_id, payload) VALUES (?, ?, ?, ?)").run(
      "r1",
      Date.now(),
      "abc",
      "{}",
    );
  }
  if (opts.withPending) {
    writePendingSwitch(dataDir, { from: "release", to: "preview/feat-x", startedAt: new Date().toISOString() });
  }
  const spawned: string[] = [];
  let shutdowns = 0;
  // No updater opt: buildApp wires the real backend by default.
  const fallback =
    opts.fakeUpdater || (opts.wrapUpdater && !opts.updater) ? new FakeUpdater(dataDir) : undefined;
  const base = opts.updater ?? fallback;
  const updater = base && opts.wrapUpdater ? opts.wrapUpdater(base) : base;
  const created = await createApp(TOKEN, {
    db,
    dataDir,
    settings,
    jobs: opts.jobs ?? new JobQueue(),
    ...(updater ? { updater } : {}),
    updateHooks: {
      spawnHelper: async (argsFile: string) => {
        spawned.push(argsFile);
        return 9999;
      },
      requestShutdown: () => {
        shutdowns += 1;
      },
      // No 500 ms shutdown delay in tests (issue #119): the reply flush
      // wait is production behaviour, covered by the detached-helper path.
      shutdownDelayMs: 0,
    },
  });
  return {
    app: created.app,
    dataDir,
    spawned,
    shutdownCalls: () => shutdowns,
    close: async () => {
      process.argv[1] = savedArgv1;
      await created.app.close();
    },
  };
}

function auth(
  url: string,
  body?: unknown,
  method = "GET",
): { method: string; url: string; headers: Record<string, string>; payload?: string } {
  return {
    method,
    url,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  };
}

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("update status", () => {
  it("works with the gate off and is token-gated", async () => {
    const h = await makeHarness();
    try {
      const anon = await h.app.inject({ method: "GET", url: "/api/update/status" });
      expect(anon.statusCode).toBe(401);
      const res = await h.app.inject(auth("/api/update/status"));
      expect(res.statusCode).toBe(200);
      const body = res.json() as UpdateStatusResponse;
      expect(body.enabled).toBe(false);
      expect(body.pending).toBeNull();
      expect(body.outcome).toBeNull();
      // Installed build identity comes from the installed package.
      expect(body.build).toEqual({ version: "0.0.1", channel: "release", sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: null, builtAt: null });
    } finally {
      await h.close();
    }
  });

  it("sits behind the loopback host gate like every other route", async () => {
    const h = await makeHarness();
    try {
      const res = await h.app.inject({
        method: "GET",
        url: "/api/update/status",
        headers: { authorization: `Bearer ${TOKEN}`, host: "evil.example" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await h.close();
    }
  });
});

describe("update channels", () => {
  it("404s with the gate off, 401s anonymously", async () => {
    const h = await makeHarness();
    try {
      expect((await h.app.inject(auth("/api/update/channels"))).statusCode).toBe(404);
      expect((await h.app.inject({ method: "GET", url: "/api/update/channels" })).statusCode).toBe(401);
      const body = (await h.app.inject(auth("/api/update/channels"))).json() as { error: string };
      expect(body.error).toContain("turned off");
    } finally {
      await h.close();
    }
  });

  it("defaults to the real backend (channels file override, no gh)", async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    const file = path.join(dir, "update", "channels.json");
    fs.writeFileSync(file, JSON.stringify([{ ref: "release", version: "0.0.1" }]));
    const prev = process.env.UNVIBE_UPDATE_CHANNELS_FILE;
    process.env.UNVIBE_UPDATE_CHANNELS_FILE = file;
    // No updater opt: buildApp wires the real backend by default.
    const h = await makeHarness({ gate: true, updater: undefined });
    try {
      const res = await h.app.inject(auth("/api/update/channels"));
      expect(res.statusCode).toBe(200);
      expect((res.json() as { channels: UpdateChannel[] }).channels.map((c) => c.ref)).toEqual(["release"]);
    } finally {
      await h.close();
      if (prev === undefined) delete process.env.UNVIBE_UPDATE_CHANNELS_FILE;
      else process.env.UNVIBE_UPDATE_CHANNELS_FILE = prev;
    }
  });

  it("lists channels with the current one marked, cached briefly", async () => {
    let calls = 0;
    const h = await makeHarness({
      gate: true,
      wrapUpdater: (base: Updater): Updater => ({
        listChannels: async (): Promise<UpdateChannel[]> => {
          calls += 1;
          return base.listChannels();
        },
        switchTo: (ref: string) => base.switchTo(ref),
      }),
    });
    try {
      const first = await h.app.inject(auth("/api/update/channels"));
      expect(first.statusCode).toBe(200);
      const channels = (first.json() as { channels: UpdateChannel[] }).channels;
      expect(channels.length).toBeGreaterThanOrEqual(3);
      expect(channels.filter((c) => c.current)).toHaveLength(1);
      const second = await h.app.inject(auth("/api/update/channels"));
      expect(second.statusCode).toBe(200);
      expect(calls).toBe(1);
      const refreshed = await h.app.inject(auth("/api/update/channels?refresh=1"));
      expect(refreshed.statusCode).toBe(200);
      expect(calls).toBe(2);
    } finally {
      await h.close();
    }
  });
});

describe("update switch", () => {
  it("validates, refuses busy/lease/pending, commits with hooks", async () => {
    const h = await makeHarness({ gate: true, fakeUpdater: true });
    try {
      // 400 on a missing ref.
      expect((await h.app.inject(auth("/api/update/switch", {}, "POST"))).statusCode).toBe(400);
      // 404 on an unknown ref.
      const unknown = await h.app.inject(auth("/api/update/switch", { ref: "preview/nope" }, "POST"));
      expect(unknown.statusCode).toBe(404);

      // Happy path: 202, pending file, helper args, shutdown trigger.
      const ok = await h.app.inject(auth("/api/update/switch", { ref: "preview/feat-x" }, "POST"));
      expect(ok.statusCode).toBe(202);
      expect(ok.json()).toEqual({ from: "release", to: "preview/feat-x" });
      expect(readPendingSwitch(h.dataDir)).toMatchObject({ from: "release", to: "preview/feat-x" });
      expect(h.spawned).toHaveLength(1);
      const args = JSON.parse(fs.readFileSync(h.spawned[0], "utf8")) as Record<string, unknown>;
      expect(args).toMatchObject({
        from: "release",
        to: "preview/feat-x",
        targetVersion: "0.0.1-preview.feat-x.abc1234",
        fromVersion: "0.0.1",
        dataDir: h.dataDir,
        servicePid: process.pid,
        serviceVersion: SERVICE_VERSION,
      });
      // The installed build is identified from the service entry path.
      expect(args["scriptPath"]).toBe(process.argv[1]);
      // The detached helper inherits the service's repaired PATH (issue
      // #170), so npm wrappers find mise after the service has exited.
      expect(args["effectivePath"]).toBe(process.env.PATH);
      expect(await waitFor(() => h.shutdownCalls() === 1, UPDATE_SHUTDOWN_DELAY_MS + 2500)).toBe(true);

      // A second switch while pending is refused.
      const again = await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"));
      expect(again.statusCode).toBe(409);
      expect((again.json() as { error: string }).error).toContain("already in progress");
    } finally {
      await h.close();
    }
  });

  it("refuses while jobs run with a structured body (code + count + job list)", async () => {
    const jobs = new JobQueue();
    jobs.enqueue({
      kind: "reader",
      provider: "claude",
      model: "m",
      effort: "",
      reviewId: "r",
      priority: 1,
      run: () => new Promise<never>(() => {}),
    });
    const h = await makeHarness({ gate: true, fakeUpdater: true, jobs });
    try {
      const res = await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"));
      expect(res.statusCode).toBe(409);
      const body = res.json() as {
        error: string;
        code: string;
        activeJobs: number;
        jobs: { id: string; kind: string; reviewId?: string; state: string }[];
      };
      expect(body.error).toContain("job");
      expect(body.code).toBe("jobs-running");
      expect(body.activeJobs).toBe(1);
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0]).toMatchObject({ kind: "reader", reviewId: "r", state: "running" });
      expect(readPendingSwitch(h.dataDir)).toBeNull();
      expect(h.spawned).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it("caps the blocking-job list at 5 with the full count", async () => {
    const jobs = new JobQueue({ getConcurrencyCap: () => 10 });
    for (let i = 0; i < 7; i += 1) {
      jobs.enqueue({
        kind: "reader",
        provider: "claude",
        model: "m",
        effort: "",
        reviewId: `r-${i}`,
        priority: 1,
        run: () => new Promise<never>(() => {}),
      });
    }
    const h = await makeHarness({ gate: true, fakeUpdater: true, jobs });
    try {
      const res = await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"));
      expect(res.statusCode).toBe(409);
      const body = res.json() as { activeJobs: number; jobs: unknown[] };
      expect(body.activeJobs).toBe(7);
      expect(body.jobs).toHaveLength(5);
    } finally {
      await h.close();
    }
  });

  it("force: true skips the jobs refusal and records the interrupted count", async () => {
    const jobs = new JobQueue();
    jobs.enqueue({
      kind: "ask",
      provider: "claude",
      model: "m",
      effort: "",
      reviewId: "r",
      priority: 1,
      run: () => new Promise<never>(() => {}),
    });
    const h = await makeHarness({ gate: true, fakeUpdater: true, jobs });
    try {
      const res = await h.app.inject(auth("/api/update/switch", { ref: "preview/feat-x", force: true }, "POST"));
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ from: "release", to: "preview/feat-x" });
      expect(readPendingSwitch(h.dataDir)).toMatchObject({
        from: "release",
        to: "preview/feat-x",
        interruptedJobs: 1,
      });
      expect(h.spawned).toHaveLength(1);
      const args = JSON.parse(fs.readFileSync(h.spawned[0], "utf8")) as Record<string, unknown>;
      expect(args["interruptedJobs"]).toBe(1);
      expect(await waitFor(() => h.shutdownCalls() === 1, UPDATE_SHUTDOWN_DELAY_MS + 2500)).toBe(true);
    } finally {
      await h.close();
    }
  });

  it("force does not bypass the submit lease, pending switch, gate, or installed check", async () => {
    // Submit lease still refuses.
    const leased = await makeHarness({ gate: true, fakeUpdater: true, withLease: true });
    try {
      const res = await leased.app.inject(auth("/api/update/switch", { ref: "release", force: true }, "POST"));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain("submit");
      expect(leased.spawned).toHaveLength(0);
    } finally {
      await leased.close();
    }
    // A pending switch still refuses.
    const pending = await makeHarness({ gate: true, fakeUpdater: true, withPending: true });
    try {
      const res = await pending.app.inject(auth("/api/update/switch", { ref: "release", force: true }, "POST"));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain("already in progress");
      expect(pending.spawned).toHaveLength(0);
    } finally {
      await pending.close();
    }
    // Gate off still 404s.
    const gated = await makeHarness({ fakeUpdater: true });
    try {
      expect(
        (await gated.app.inject(auth("/api/update/switch", { ref: "release", force: true }, "POST"))).statusCode,
      ).toBe(404);
    } finally {
      await gated.close();
    }
    // Not installed still refuses.
    const checkout = await makeHarness({ gate: true, install: null });
    try {
      const res = await checkout.app.inject(auth("/api/update/switch", { ref: "release", force: true }, "POST"));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain("installed with npm");
      expect(checkout.spawned).toHaveLength(0);
    } finally {
      await checkout.close();
    }
  });

  it("refuses while a submit is in flight", async () => {
    const h = await makeHarness({ gate: true, fakeUpdater: true, withLease: true });
    try {
      const res = await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain("submit");
      expect(h.spawned).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it("404s with the gate off and 401s anonymously", async () => {
    const h = await makeHarness();
    try {
      expect((await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"))).statusCode).toBe(404);
      expect(
        (await h.app.inject({ method: "POST", url: "/api/update/switch", payload: JSON.stringify({ ref: "release" }) }))
          .statusCode,
      ).toBe(401);
    } finally {
      await h.close();
    }
  });

  it("refuses when not running from an installed build", async () => {
    const h = await makeHarness({ gate: true, install: null });
    try {
      const res = await h.app.inject(auth("/api/update/switch", { ref: "release" }, "POST"));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain("installed with npm");
      expect(h.spawned).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it("same channel + same commit is a no-op; moved commit goes through the flow", async () => {
    // Installed commit matches the published one (fake seed): unchanged.
    const same = await makeHarness({
      gate: true,
      fakeUpdater: true,
      install: { channel: "preview/feat-x", version: "0.0.1-preview.feat-x.abc1234", commit: "abc1234def5678" },
    });
    try {
      const res = await same.app.inject(auth("/api/update/switch", { ref: "preview/feat-x" }, "POST"));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ from: "preview/feat-x", to: "preview/feat-x", unchanged: true });
      expect(same.spawned).toHaveLength(0);
    } finally {
      await same.close();
    }
    // Installed commit behind the published one: full flow with from === to.
    const behind = await makeHarness({
      gate: true,
      fakeUpdater: true,
      install: { channel: "preview/feat-x", version: "0.0.1-preview.feat-x.older", commit: "older12" },
    });
    try {
      const res = await behind.app.inject(auth("/api/update/switch", { ref: "preview/feat-x" }, "POST"));
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ from: "preview/feat-x", to: "preview/feat-x" });
      expect(readPendingSwitch(behind.dataDir)).toMatchObject({ from: "preview/feat-x", to: "preview/feat-x" });
    } finally {
      await behind.close();
    }
  });
});

describe("health build identity", () => {
  it("reports the fake channel build under UNVIBE_UPDATER_BACKEND=fake", async () => {
    const prev = process.env.UNVIBE_UPDATER_BACKEND;
    process.env.UNVIBE_UPDATER_BACKEND = "fake";
    try {
      const h = await makeHarness({ gate: true });
      try {
        fs.mkdirSync(path.join(h.dataDir, "update"), { recursive: true });
        fs.writeFileSync(
          path.join(h.dataDir, "update", "fake-channels.json"),
          JSON.stringify([{ ref: "release", version: "0.0.1" }, { ref: "preview/e2e", version: "0.0.1-preview.e2e.1" }]),
        );
        fs.writeFileSync(path.join(h.dataDir, "update", "current-ref"), "preview/e2e\n");
        const res = await h.app.inject({ method: "GET", url: "/api/health" });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { version: string; build: { version: string } | null };
        expect(body.build?.version).toBe("0.0.1-preview.e2e.1");
      } finally {
        await h.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_UPDATER_BACKEND;
      else process.env.UNVIBE_UPDATER_BACKEND = prev;
    }
  });
});
