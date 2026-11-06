/**
 * Trace routes (issue #356): recording status, export, clear, and the
 * browser-span beacon. Explicit and local only: nothing is uploaded, and
 * spans are stored only while `Settings.recordTraces` is on.
 */
import type { FastifyInstance } from "fastify";
import type { TraceRecorder } from "../traces/recorder.js";
import type { BrowserSpanBatch } from "../traces/recorder.js";
import type { RouteDeps } from "./deps.js";

export interface TracesRouteDeps extends RouteDeps {
  traces?: TraceRecorder;
}

export async function registerTraces(app: FastifyInstance, deps: TracesRouteDeps = {}): Promise<void> {
  app.get("/api/traces/status", async (_req, reply) => {
    if (!deps.traces) return reply.code(501).send({ error: "traces are not available in this build" });
    return deps.traces.status();
  });

  app.get("/api/traces/export", async (_req, reply) => {
    if (!deps.traces) return reply.code(501).send({ error: "traces are not available in this build" });
    return reply
      .header("content-disposition", 'attachment; filename="unvibe-traces.json"')
      .send(deps.traces.exportOtlp());
  });

  app.post("/api/traces/clear", async (_req, reply) => {
    if (!deps.traces) return reply.code(501).send({ error: "traces are not available in this build" });
    deps.traces.clear();
    return deps.traces.status();
  });

  app.post("/api/traces/spans", async (req, reply) => {
    if (!deps.traces) return reply.code(501).send({ error: "traces are not available in this build" });
    const body = (req.body ?? {}) as Partial<BrowserSpanBatch>;
    if (!Array.isArray(body.spans)) return reply.code(400).send({ error: "body must be { spans: [...] }" });
    return deps.traces.ingestBrowser({ spans: body.spans });
  });
}
