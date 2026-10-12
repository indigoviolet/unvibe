/**
 * Switch-helper state machine (issue #36, step 2): every step injected,
 * so the full matrix runs without real processes, npm or network.
 */
import { describe, expect, it } from "vitest";
import type { SwitchOutcome } from "@unvibe/shared";
import {
  healthMatchesTarget,
  runSwitchFlow,
  type HelperDeps,
  type ObservedHealth,
  type SwitchPlan,
} from "../src/update/helper.js";

const PLAN: SwitchPlan = {
  from: "release",
  to: "preview/feat-x",
  targetVersion: "0.0.1-preview.feat-x.abc1234",
  fromVersion: "0.0.1",
  port: 4521,
  dataDir: "/tmp/unvibe-test",
  servicePid: 4242,
  exitWaitMs: 1000,
  healthTimeoutMs: 2000,
  pollIntervalMs: 50,
  stopWaitMs: 1000,
  logPath: "/tmp/unvibe-test/update/switch-1.log",
};

interface Script {
  exit?: boolean;
  switchThrows?: string[];
  health?: (ObservedHealth | null)[];
  /** Per-poll answers for isCurrentService (default all true). */
  current?: boolean[];
}

interface ScriptState {
  outcomes: SwitchOutcome[];
  pendingCleared: number;
  switches: string[];
  starts: number;
  startedPids: number[];
  stopped: number[];
  expects: (string | null)[];
  events: string[];
  logs: string[];
}

function makeDeps(script: Script): HelperDeps & ScriptState {
  const outcomes: SwitchOutcome[] = [];
  const switches: string[] = [];
  const startedPids: number[] = [];
  const stopped: number[] = [];
  const expects: (string | null)[] = [];
  const events: string[] = [];
  const logs: string[] = [];
  let pendingCleared = 0;
  let healthCalls = 0;
  let currentCalls = 0;
  let lastCurrent = true;
  let nextPid = 5000;
  // Steady state: an exhausted script repeats its last non-null sample
  // (a live build keeps reporting), while null stays null (nothing there).
  let lastSeen: ObservedHealth | null = null;
  return {
    get outcomes() {
      return outcomes;
    },
    get pendingCleared() {
      return pendingCleared;
    },
    get switches() {
      return switches;
    },
    get starts() {
      return startedPids.length;
    },
    get startedPids() {
      return startedPids;
    },
    get stopped() {
      return stopped;
    },
    get expects() {
      return expects;
    },
    get events() {
      return events;
    },
    get logs() {
      return logs;
    },
    waitForExit: async () => script.exit ?? true,
    switchTo: async (ref: string) => {
      switches.push(ref);
      events.push(`switch:${ref}`);
      if (script.switchThrows?.includes(ref)) throw new Error(`boom installing ${ref}`);
      return { from: PLAN.from, to: ref };
    },
    startService: async () => {
      nextPid += 1;
      startedPids.push(nextPid);
      events.push(`start:${nextPid}`);
      return nextPid;
    },
    stopService: async (pid: number) => {
      stopped.push(pid);
      events.push(`stop:${pid}`);
    },
    isCurrentService: async () => {
      const scripted = script.current ?? [];
      if (currentCalls < scripted.length) lastCurrent = scripted[currentCalls++];
      return lastCurrent;
    },
    pollHealth: async (_t: number, _i: number, expect: string | null) => {
      expects.push(expect);
      const scripted = script.health ?? [];
      if (healthCalls < scripted.length) {
        const next = scripted[healthCalls++];
        if (next) lastSeen = next;
        return next;
      }
      return lastSeen;
    },
    recordOutcome: (o: SwitchOutcome) => {
      outcomes.push(o);
    },
    clearPending: () => {
      pendingCleared += 1;
    },
    log: (m: string) => {
      logs.push(m);
    },
    nowIso: () => "2026-10-12T00:00:00.000Z",
  };
}

const HEALTHY: ObservedHealth = { version: "0.0.1-preview.feat-x.abc1234", buildVersion: null };
/** The rolled-back build reporting the previous version. */
const OLD_HEALTHY: ObservedHealth = { version: "0.0.1", buildVersion: null };

describe("runSwitchFlow", () => {
  it("success records ok and clears pending", async () => {
    const deps = makeDeps({ health: [HEALTHY] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("ok");
    expect(out.from).toBe("release");
    expect(out.to).toBe("preview/feat-x");
    expect(out.finishedAt).toBe("2026-10-12T00:00:00.000Z");
    expect(out.logPath).toBe(PLAN.logPath);
    expect(out.reason).toBeUndefined();
    expect(deps.switches).toEqual(["preview/feat-x"]);
    expect(deps.starts).toBe(1);
    expect(deps.pendingCleared).toBe(1);
    expect(deps.outcomes).toHaveLength(1);
  });

  it("forced switch carries the interrupted count onto every outcome", async () => {
    const okDeps = makeDeps({ health: [HEALTHY] });
    const ok = await runSwitchFlow({ ...PLAN, interruptedJobs: 2 }, okDeps);
    expect(ok.status).toBe("ok");
    expect(ok.interruptedJobs).toBe(2);

    const backDeps = makeDeps({ switchThrows: ["preview/feat-x"], health: [OLD_HEALTHY] });
    const back = await runSwitchFlow({ ...PLAN, interruptedJobs: 2 }, backDeps);
    expect(back.status).toBe("rolled-back");
    expect(back.interruptedJobs).toBe(2);
  });

  it("unforced switch leaves the interrupted count absent", async () => {
    const deps = makeDeps({ health: [HEALTHY] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.interruptedJobs).toBeUndefined();
  });

  it("install failure rolls back to the previous ref", async () => {
    const deps = makeDeps({ switchThrows: ["preview/feat-x"], health: [OLD_HEALTHY] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("rolled-back");
    expect(out.reason).toContain("install of preview/feat-x failed");
    expect(deps.switches).toEqual(["preview/feat-x", "release"]);
    expect(deps.starts).toBe(1);
  });

  it("unhealthy new build rolls back", async () => {
    const deps = makeDeps({ health: [null, OLD_HEALTHY] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("rolled-back");
    expect(out.reason).toContain("not healthy within 2000ms");
    expect(deps.switches).toEqual(["preview/feat-x", "release"]);
    expect(deps.starts).toBe(2);
  });

  it("wrong version on the new build rolls back with a mismatch reason", async () => {
    const deps = makeDeps({
      health: [{ version: "0.0.1", buildVersion: null }, OLD_HEALTHY],
    });
    // A steady wrong version burns the poll each time; keep it short.
    const out = await runSwitchFlow({ ...PLAN, healthTimeoutMs: 120, pollIntervalMs: 5 }, deps);
    expect(out.status).toBe("rolled-back");
    expect(out.reason).toContain("instead of 0.0.1-preview.feat-x.abc1234");
  });

  it("build-version field is what matches when present", async () => {
    const deps = makeDeps({
      health: [{ version: "0.0.1", buildVersion: "0.0.1-preview.feat-x.abc1234" }],
    });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("ok");
  });

  it("null target version accepts any healthy build", async () => {
    const deps = makeDeps({ health: [{ version: "9.9.9", buildVersion: null }] });
    const out = await runSwitchFlow({ ...PLAN, targetVersion: null }, deps);
    expect(out.status).toBe("ok");
  });

  it("failed rollback records failed", async () => {
    const deps = makeDeps({ switchThrows: ["preview/feat-x", "release"] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("install of preview/feat-x failed");
    expect(out.reason).toContain("rollback to release also failed");
    expect(deps.starts).toBe(0);
  });

  it("rolled-back build staying down records failed with the recovery path", async () => {
    const deps = makeDeps({ health: [null, null] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("rolled-back build did not become healthy");
    expect(out.reason).toContain("npm install -g github:indigoviolet/unvibe#release");
  });

  it("service that never exits aborts without touching the install", async () => {
    const deps = makeDeps({ exit: false });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("did not exit within 1000ms");
    expect(out.reason).toContain("install was left untouched");
    // The failure names the likely cause and the exact recovery: the live
    // service keeps serving (pending was cleared, nothing half-applied).
    expect(out.reason).toContain("stuck shutting down");
    expect(out.reason).toContain("unvibe stop");
    expect(out.reason).toContain(`unvibe update ${PLAN.to}`);
    expect(deps.switches).toEqual([]);
    expect(deps.starts).toBe(0);
    // The live service surfaces the failure via status.
    expect(deps.pendingCleared).toBe(1);
    expect(deps.outcomes).toHaveLength(1);
  });

  it("rollback stops the helper's own previous generation first", async () => {
    const deps = makeDeps({ health: [null, OLD_HEALTHY] });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("rolled-back");
    expect(deps.startedPids).toHaveLength(2);
    // The first generation is stopped before the rollback generation starts.
    expect(deps.stopped).toEqual([deps.startedPids[0]]);
    const [first, second] = deps.startedPids;
    expect(deps.events).toEqual([
      `switch:${PLAN.to}`,
      `start:${first}`,
      `stop:${first}`,
      `switch:${PLAN.from}`,
      `start:${second}`,
    ]);
    // The install waits for the target, the rollback for the old version.
    expect(deps.expects).toEqual([PLAN.targetVersion, PLAN.fromVersion]);
  });

  it("ignores health samples from a stale generation", async () => {
    const deps = makeDeps({
      health: [{ version: "0.0.1", buildVersion: null }, HEALTHY],
      current: [false, true],
    });
    const out = await runSwitchFlow(PLAN, deps);
    expect(out.status).toBe("ok");
    expect(deps.starts).toBe(1);
    expect(deps.stopped).toEqual([]);
    expect(deps.logs.some((l) => l.includes("stale generation"))).toBe(true);
  });

  it("a permanently stale generation fails instead of trusting it", async () => {
    const deps = makeDeps({ health: [HEALTHY, HEALTHY], current: [false, false, false, false] });
    const out = await runSwitchFlow({ ...PLAN, healthTimeoutMs: 50, pollIntervalMs: 5 }, deps);
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("did not become healthy");
    // The first generation was stopped before the rollback restart; the
    // told-about service PID was never passed to stopService.
    expect(deps.stopped).toEqual([deps.startedPids[0]]);
    expect(deps.startedPids).toHaveLength(2);
  });
});

describe("healthMatchesTarget", () => {
  it("prefers the build version, accepts null targets", () => {
    expect(healthMatchesTarget(HEALTHY, PLAN.targetVersion)).toBe(true);
    expect(healthMatchesTarget({ version: "x", buildVersion: "y" }, "y")).toBe(true);
    expect(healthMatchesTarget({ version: "x", buildVersion: "y" }, "x")).toBe(false);
    expect(healthMatchesTarget({ version: "x", buildVersion: null }, null)).toBe(true);
  });
});
