/**
 * Per-install token (PRD §14).
 *
 * Generated once on first start, stored with owner-only permissions in the
 * data dir, and required on every HTTP and WS request except `/api/health`.
 * Accepted as `Authorization: Bearer <token>`, `?token=`, or the
 * `__unvibe_token` cookie (set by the web app from the URL token so that
 * static asset loads after the first page load also authenticate).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TOKEN_COOKIE = "__unvibe_token";

export function tokenFilePath(dataDir: string): string {
  return path.join(dataDir, "token");
}

/** Load the token, generating and persisting it on first start. */
export function loadOrCreateToken(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = tokenFilePath(dataDir);
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // fall through to creation
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: ignore
  }
  return token;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export interface TokenRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}

/** True when the request carries the expected token. */
export function hasValidToken(req: TokenRequest, expected: string): boolean {
  const auth = req.headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (header) {
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim() === expected) return true;
  }
  const q = req.query?.["token"];
  const queryToken = Array.isArray(q) ? q[0] : q;
  if (queryToken === expected) return true;
  const cookies = parseCookies(
    Array.isArray(req.headers["cookie"]) ? req.headers["cookie"][0] : req.headers["cookie"],
  );
  if (cookies[TOKEN_COOKIE] === expected) return true;
  return false;
}
