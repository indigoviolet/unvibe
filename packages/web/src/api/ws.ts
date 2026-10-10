/** WebSocket client with reconnect (events: job progress, text, patches). */
import type { ReviewEvent } from "@unvibe/shared";
import { getToken } from "./client.js";

export interface WsOptions {
  reviewId: string;
  onEvent: (event: ReviewEvent) => void;
  onStatus?: (connected: boolean) => void;
  /** Base delay ms; doubled per attempt up to 10s. */
  baseDelayMs?: number;
}

function wsUrl(reviewId: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const token = getToken();
  const qs = new URLSearchParams({ review: reviewId, ...(token ? { token } : {}) });
  return `${proto}://${window.location.host}/api/events?${qs}`;
}

/** Connect; returns a disconnect function. Reconnects on drop. */
export function connectEvents(opts: WsOptions): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | undefined;

  const connect = (): void => {
    if (closed) return;
    opts.onStatus?.(false);
    socket = new WebSocket(wsUrl(opts.reviewId));
    socket.onopen = () => {
      attempt = 0;
      opts.onStatus?.(true);
    };
    socket.onmessage = (msg) => {
      try {
        opts.onEvent(JSON.parse(String(msg.data)) as ReviewEvent);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      opts.onStatus?.(false);
      if (closed) return;
      const delay = Math.min(10_000, (opts.baseDelayMs ?? 500) * 2 ** attempt++);
      timer = window.setTimeout(connect, delay);
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
