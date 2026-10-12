/**
 * Bounded, ordered service shutdown (issues #30, #36 follow-up).
 *
 * The old path registered teardown hooks on `ShutdownHooks` (which runs
 * latest-registered first), so the DB closed first and the HTTP server
 * closed before agent subprocesses were disposed. With live agent
 * sessions that hung forever: `app.close()` (Fastify 5, default
 * `forceCloseConnections: "idle"`) waits for non-idle connections, the
 * MCP endpoint hijacks the reply for a long-lived SSE stream, and
 * `@fastify/websocket` only sends graceful closes — which a deaf peer
 * never answers — while the agents that could drop those streams were
 * disposed only after `app.close()` returned. The switch helper never
 * kills the told-about PID, so the switch timed out with the install
 * untouched and a half-torn-down service left alive (`unvibe stop` hid
 * this by SIGKILLing after 5 s).
 *
 * This module runs the phases in an explicit order — abort jobs, dispose
 * agents (subprocesses die, their MCP streams drop), close MCP sessions
 * + WebSocket clients explicitly, close HTTP with remaining connections
 * force-closed, close the DB last, flush telemetry — with a bound on
 * every step and a hard deadline on the whole run. Afterwards the caller
 * exits the process no matter what, so a stuck shutdown can never leave
 * a live process with a closed DB.
 */

export interface ServiceShutdownSteps {
  /** Abort + mark jobs (fast, sync). */
  abortJobs(): void | Promise<void>;
  /** Kill agent-subprocess transports. */
  disposeAgents(): void | Promise<void>;
  /** Close MCP transports + terminate WS clients explicitly. */
  closeRealtime(): void | Promise<void>;
  /** Force-close leftover sockets, then close the HTTP server. */
  closeHttp(): void | Promise<void>;
  /** Close the database. Always runs last-but-one. */
  closeDb(): void | Promise<void>;
  /** Flush telemetry. Always runs last. */
  flushTelemetry(): void | Promise<void>;
}

export type ServiceShutdownStepName = keyof ServiceShutdownSteps;

export interface ServiceShutdownOptions {
  /** Per-step bound in ms (a hung step is skipped, never waited on). */
  stepMs?: number;
  /** Whole-run deadline in ms (then the caller exits anyway). */
  totalMs?: number;
  /** Called for every step that hits its bound (logging). */
  onTimeout?: (step: string) => void;
}

export interface ServiceShutdownReport {
  ok: boolean;
  /** Steps that ran (a throwing step counts as ran: teardown is best-effort). */
  completed: string[];
  /** Steps skipped on their bound, plus `"total"` when the deadline fired. */
  timedOut: string[];
}

/** Per-step bound: each phase must finish or be skipped within this. */
export const SHUTDOWN_STEP_MS = 4_000;
/**
 * Whole-shutdown deadline. Must stay comfortably below the switch
 * helper's exit wait (`UPDATE_EXIT_WAIT_MS` in `routes/update.ts`, 30 s):
 * a bounded shutdown always finishes first, so the helper only reports a
 * stuck service when the machine itself is wedged.
 */
export const SHUTDOWN_DEADLINE_MS = 10_000;

const ORDER: ServiceShutdownStepName[] = [
  "abortJobs",
  "disposeAgents",
  "closeRealtime",
  "closeHttp",
  "closeDb",
  "flushTelemetry",
];

export async function shutdownService(
  steps: ServiceShutdownSteps,
  opts: ServiceShutdownOptions = {},
): Promise<ServiceShutdownReport> {
  const stepMs = opts.stepMs ?? SHUTDOWN_STEP_MS;
  const totalMs = opts.totalMs ?? SHUTDOWN_DEADLINE_MS;
  const completed: string[] = [];
  const timedOut: string[] = [];
  let totalFired = false;

  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"total">((resolve) => {
    totalTimer = setTimeout(() => {
      totalFired = true;
      resolve("total");
    }, totalMs);
  });

  const runAll = (async (): Promise<"all"> => {
    for (const name of ORDER) {
      // The deadline fired while an earlier step hung: stop starting new
      // phases (the caller is already exiting); the hung step's own bound
      // still releases it in the background.
      if (totalFired) {
        timedOut.push(name);
        continue;
      }
      const attempt = (async (): Promise<void> => {
        try {
          await steps[name]();
        } catch {
          // Best-effort teardown: one failing phase never blocks the rest.
        } finally {
          completed.push(name);
        }
      })();
      // A hung phase must not block the rest: a late rejection is already
      // handled above, so awaiting it later can never throw.
      void attempt.catch(() => {});
      let stepTimer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        attempt.then((): "done" => "done"),
        new Promise<"step-timeout">((resolve) => {
          stepTimer = setTimeout(() => resolve("step-timeout"), stepMs);
        }),
      ]);
      if (stepTimer !== undefined) clearTimeout(stepTimer);
      if (outcome === "step-timeout") {
        timedOut.push(name);
        try {
          opts.onTimeout?.(name);
        } catch {
          // Logging must not break shutdown.
        }
      }
    }
    return "all";
  })();
  // A hung run keeps going in the background (bounded by its step timers)
  // but can no longer delay the report — the caller exits on the deadline.
  void runAll.catch(() => {});

  const winner = await Promise.race([runAll, deadline]);
  if (totalTimer !== undefined) clearTimeout(totalTimer);
  if (winner === "total") timedOut.push("total");
  return { ok: timedOut.length === 0, completed, timedOut };
}
