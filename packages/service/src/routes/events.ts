import type { FastifyInstance } from "fastify";
import type { EventBus } from "../events.js";

/**
 * WS /api/events?review=:id — job progress, streamed text, state patches.
 * Auth is enforced by the global hook (same token rules as HTTP).
 * Scaffold: accepts the socket and keeps it on the bus; owners publish.
 */
export async function registerEvents(app: FastifyInstance, bus: EventBus): Promise<void> {
  app.get("/api/events", { websocket: true }, (socket, req) => {
    const q = req.query as Record<string, string | undefined>;
    const reviewId = q["review"] ?? "global";
    const send = (event: unknown): void => {
      socket.send(JSON.stringify(event));
    };
    const unsub = bus.subscribe(reviewId, send);
    socket.on("close", () => unsub());
    socket.on("error", () => unsub());
  });
}
