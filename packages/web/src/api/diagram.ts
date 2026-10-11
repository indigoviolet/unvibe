/**
 * Diagram endpoint error (leaf module: no imports, so neither the API
 * client nor the mock can form an import cycle through it).
 *
 * `409` from `GET /api/reviews/:id/diagrams/:hash`: the hash is known but
 * has no SVG (binary missing/too old, or the source failed to compile).
 * Thrown typed so the diagram component renders the matching fallback.
 */
export class DiagramStatusError extends Error {
  status: "unavailable" | "error";
  detail?: string;
  constructor(status: "unavailable" | "error", detail?: string) {
    super(`diagram ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "DiagramStatusError";
    this.status = status;
    this.detail = detail;
  }
}
