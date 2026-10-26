/**
 * Diagnostics + reload endpoints (issue #20).
 *
 * - `GET /api/diagnostics` — full report from the shared diagnostics module
 *   (PATH probe, every tool candidate, service identity, warnings, model
 *   display names). Token-gated like everything else; the report never
 *   contains the token (API tests assert this).
 * - `POST /api/reload` — "Reload everything" without restarting the
 *   service: re-probe PATH (updates `process.env.PATH`), re-resolve tools,
 *   restart agent adapter subprocesses (in-flight prompts fail as retryable
 *   with a clear message; jobs back off and retry), clear readiness and
 *   model caches, re-check d2. Returns what changed.
 */
import type { FastifyInstance } from "fastify";
import type { DiagnosticsResponse, ModelInfo } from "@unvibe/shared";
import { collectDiagnostics } from "../diagnostics/report.js";
import { clearShimResolutionCache } from "../exec/shim-resolve.js";
import { applyLoginShellPath } from "../diagnostics/path-probe.js";
import { clearReadinessCache, getReadiness } from "../readiness/index.js";
import { loadConfig } from "../config.js";
import { readLock } from "../cli/lock.js";
import type { RouteDeps } from "./deps.js";
import type { ServiceContext } from "./context.js";

function serviceIdentity(): { pid: number; startedAt: string; cwd: string; dataDir: string; port: number } {
  let config: { dataDir: string; port: number };
  try {
    config = loadConfig();
  } catch {
    config = { dataDir: "", port: 0 };
  }
  let startedAt = "";
  try {
    const lock = readLock(config.dataDir);
    if (lock?.startedAt) startedAt = lock.startedAt;
  } catch {
    // ignore
  }
  if (!startedAt) {
    try {
      // Fallback: process start time approx (no lock yet in tests).
      startedAt = new Date(Date.now()).toISOString();
    } catch {
      startedAt = "";
    }
  }
  return {
    pid: process.pid,
    startedAt,
    cwd: process.cwd(),
    dataDir: config.dataDir,
    port: config.port,
  };
}

async function modelsForDiagnostics(deps: RouteDeps): Promise<Record<string, ModelInfo[]> | undefined> {
  try {
    const catalog = deps.models;
    if (!catalog) return undefined;
    const out: Record<string, ModelInfo[]> = {};
    // Issue #279: pi rides along when detected (empty otherwise, skipped).
    for (const provider of ["claude", "codex", "pi"]) {
      try {
        const list = await catalog.listModels(provider);
        if (list.length > 0) out[provider] = list as ModelInfo[];
      } catch {
        // ignore per-provider
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export async function registerDiagnostics(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  // Test seam (issue #40): the tool `--version` probes run through the
  // app's injectable command runner, and tests may also stub the
  // login-shell PATH probe via `deps.diagnostics`. Production passes
  // neither (real runner, real shells), so runtime behaviour is unchanged.
  const probeOverride =
    deps.diagnostics?.pathProbe !== undefined ? { pathProbe: deps.diagnostics.pathProbe } : {};
  app.get("/api/diagnostics", async () => {
    const ident = serviceIdentity();
    // Prefer the real dataDir/port from ctx when present (tests inject temp dirs).
    const ctxAny = { ...ctx, ...deps } as { dataDir?: string };
    const dataDir = typeof ctxAny.dataDir === "string" && ctxAny.dataDir ? ctxAny.dataDir : ident.dataDir;
    const models = await modelsForDiagnostics({ ...ctx, ...deps } as RouteDeps);
    const report: DiagnosticsResponse = await collectDiagnostics({
      runner: ctx.runner,
      ...probeOverride,
      service: {
        pid: ident.pid,
        startedAt: ident.startedAt,
        cwd: ident.cwd,
        dataDir,
        port: ident.port,
      },
      dataDir,
      port: ident.port,
      ...(models ? { models } : {}),
    });
    // Defense in depth: never leak the token even if a future tool prints env.
    const text = JSON.stringify(report);
    if (process.env.UNVIBE_TOKEN && text.includes(process.env.UNVIBE_TOKEN)) {
      throw new Error("diagnostics would leak token");
    }
    return report;
  });

  app.post("/api/reload", async () => {
    const before = await collectDiagnostics({
      runner: ctx.runner,
      ...probeOverride,
      service: { ...serviceIdentity(), dataDir: (ctx as unknown as { dataDir?: string }).dataDir ?? serviceIdentity().dataDir },
    });
    const changes: string[] = [];
    const detail: string[] = [];

    // 1. Re-probe PATH (scrubbed interactive probe; updates process.env.PATH).
    try {
      const applied = await applyLoginShellPath();
      if (applied) {
        changes.push("PATH re-read");
        detail.push(`PATH was re-read from ${applied.shell} and has changed.`);
      } else {
        detail.push("PATH is unchanged.");
      }
    } catch (e) {
      detail.push(`Couldn't re-read PATH: ${String(e)}`);
    }

    // 2. Restart agent adapter subprocesses (in-flight fail as retryable).
    try {
      const full = { ...ctx, ...deps } as { agents?: unknown };
      const agents = full.agents as
        | { restartTransports?: (reason?: string) => void; clearModelCache?: () => void }
        | undefined;
      if (agents && typeof agents.restartTransports === "function") {
        agents.restartTransports("reload");
        changes.push("agent CLIs restarted");
        detail.push("The agent CLIs were restarted. Jobs that were running are retried automatically.");
      } else if (agents && typeof agents.clearModelCache === "function") {
        agents.clearModelCache();
        detail.push("The model list was cleared. No agent CLI was running.");
      } else {
        detail.push("No agent CLI is in use, so nothing was restarted.");
      }
    } catch (e) {
      detail.push(`Couldn't restart the agent CLIs: ${String(e)}`);
    }

    // 3. Clear readiness + model caches (+ shim resolutions, issue #105).
    try {
      clearReadinessCache();
      clearShimResolutionCache();
    } catch {
      // ignore
    }
    try {
      const catalog = (deps as RouteDeps).models as unknown as { clearCache?: () => void } | undefined;
      if (catalog && typeof catalog.clearCache === "function") {
        catalog.clearCache();
        detail.push("The model list was cleared.");
      }
    } catch {
      // ignore
    }

    // 4. Re-check d2 + readiness (so diagrams that were "unavailable" can render).
    try {
      const full = { ...ctx, ...deps } as Parameters<typeof getReadiness>[0];
      // Force a fresh readiness probe (bypasses the 30s cache).
      await getReadiness(
        {
          runner: full.runner,
          agents: full.agents,
          settings: full.settings,
          models: full.models ?? null,
        },
        { force: true },
      );
      changes.push("checks re-run");
      detail.push("All checks were run again, including d2. Diagrams that could not be drawn are tried again.");
    } catch (e) {
      detail.push(`Couldn't re-run the checks: ${String(e)}`);
    }

    const after = await collectDiagnostics({
      runner: ctx.runner,
      ...probeOverride,
      service: { ...serviceIdentity(), dataDir: (ctx as unknown as { dataDir?: string }).dataDir ?? serviceIdentity().dataDir },
      ...(await modelsForDiagnostics({ ...ctx, ...deps } as RouteDeps).then((m) => (m ? { models: m } : {}))),
    });

    // Diff chosen tools.
    const beforeByTool = new Map(before.tools.map((t) => [t.tool, t.chosen]));
    for (const t of after.tools) {
      const was = beforeByTool.get(t.tool);
      if (was !== t.chosen) {
        changes.push(`${t.tool}: ${was ?? "(none)"} → ${t.chosen ?? "(none)"}`);
        detail.push(`${t.tool} choice changed: was ${was ?? "(none)"}, now ${t.chosen ?? "(none)"} (${t.chosenReason})`);
      }
    }
    if (changes.length === 0) changes.push("no changes");

    return { ok: true, generatedAt: Date.now(), changed: changes, detail, diagnostics: after };
  });
}
