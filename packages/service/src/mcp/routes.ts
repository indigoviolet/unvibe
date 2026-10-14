/**
 * MCP HTTP mount (streamable HTTP) on the service.
 *
 * Mounted at `/api/mcp/:secret` (all methods: POST carries messages, GET
 * opens the SSE stream, DELETE closes). The per-session secret in the URL
 * is the credential for agent subprocesses, so this path is exempt from
 * the install-token gate in `server.ts` — the service still binds
 * 127.0.0.1 only, and secrets are 256-bit + revocable.
 */
import type { FastifyInstance } from "fastify";
import type { McpRegistry } from "./registry.js";

export const MCP_ROUTE_PREFIX = "/api/mcp/";

export async function registerMcp(app: FastifyInstance, registry: McpRegistry): Promise<void> {
  app.all("/api/mcp/:secret", async (req, reply) => {
    const params = req.params as Record<string, string>;
    const secret = params["secret"] ?? "";
    if (!registry.hasSession(secret)) {
      // Counted for connection-failure detection (#51/#180): a turn whose
      // agent calls a dead URL never connects; the hit itself is the fact.
      registry.noteUnknownHit();
      reply.code(404).send({ error: "unknown mcp session" });
      return;
    }
    // Let the SDK own the raw response stream.
    reply.hijack();
    try {
      await registry.handleRequest(secret, req.raw, reply.raw, req.body);
    } catch (err) {
      try {
        reply.raw.statusCode = 500;
        reply.raw.end(err instanceof Error ? err.message : "mcp error");
      } catch {
        // response already gone
      }
    }
  });
}
