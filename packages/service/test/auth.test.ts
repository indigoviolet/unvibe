import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasValidToken, loadOrCreateToken } from "../src/auth.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-auth-"));
}

describe("loadOrCreateToken", () => {
  it("generates a token on first start and reuses it", () => {
    const dir = tmpDir();
    const first = loadOrCreateToken(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(loadOrCreateToken(dir)).toBe(first);
    expect(fs.statSync(path.join(dir, "token")).mode & 0o777).toBe(0o600);
  });
});

describe("hasValidToken", () => {
  const token = "secret";
  it("accepts Authorization: Bearer", () => {
    expect(hasValidToken({ headers: { authorization: "Bearer secret" } }, token)).toBe(true);
    expect(hasValidToken({ headers: { authorization: "Bearer wrong" } }, token)).toBe(false);
  });
  it("accepts ?token=", () => {
    expect(hasValidToken({ headers: {}, query: { token: "secret" } }, token)).toBe(true);
    expect(hasValidToken({ headers: {}, query: {} }, token)).toBe(false);
  });
  it("accepts the token cookie", () => {
    expect(
      hasValidToken({ headers: { cookie: "__unvibe_token=secret" } }, token),
    ).toBe(true);
  });
  it("rejects missing credentials", () => {
    expect(hasValidToken({ headers: {} }, token)).toBe(false);
  });
});
