/**
 * Token cookie scope (issue #108): the cookie the web app mirrors from the
 * URL token is persistent (plain bookmark survives browser restarts) and
 * keeps its attributes otherwise — `SameSite=Lax; path=/`, host-only.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_COOKIE_MAX_AGE, tokenCookie } from "./client.js";

describe("tokenCookie", () => {
  it("is persistent for a year across browser restarts", () => {
    expect(TOKEN_COOKIE_MAX_AGE).toBe(31536000);
    expect(tokenCookie("abc")).toContain("Max-Age=31536000");
  });

  it("keeps its scope at least as strict as before", () => {
    const cookie = tokenCookie("abc123");
    expect(cookie).toBe("__unvibe_token=abc123; Max-Age=31536000; SameSite=Lax; path=/");
    expect(cookie).not.toMatch(/domain=/i);
    expect(cookie).not.toMatch(/expires=/i);
    // Plain http: Secure would stop the cookie being sent at all.
    expect(cookie).not.toMatch(/secure/i);
  });

  it("encodes the token", () => {
    expect(tokenCookie("a;b c")).toContain("__unvibe_token=a%3Bb%20c;");
  });

  it("matches the offline page's copy (public/start.js mirrors the same cookie)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const startJs = fs.readFileSync(path.resolve(here, "..", "..", "public", "start.js"), "utf8");
    expect(startJs).toContain(`Max-Age=${TOKEN_COOKIE_MAX_AGE}; SameSite=Lax; path=/`);
  });
});
