/**
 * Shared Playwright fixture: the whole e2e suite fails on any browser
 * request to an origin other than the test server (PRD §16 Privacy).
 *
 * Import `{ test, expect }` from `./network-guard` instead of
 * `@playwright/test`. The `guard` fixture is auto: it records non-local
 * requests plus CSP violations during the test and asserts both are empty
 * afterwards. `data:`/`blob:` (Mermaid/icons) never count as requests.
 */
import { test as base, expect } from "@playwright/test";

export interface NetworkGuard {
  nonLocal: string[];
  csp: string[];
}

function isLocalRequest(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  } catch {
    return true;
  }
}

export const test = base.extend<{ guard: NetworkGuard }>({
  guard: [
    async ({ page }, use) => {
      const state: NetworkGuard = { nonLocal: [], csp: [] };
      page.on("request", (req) => {
        const url = req.url();
        if (!isLocalRequest(url)) state.nonLocal.push(`${req.method()} ${url}`);
      });
      page.on("console", (msg) => {
        const text = msg.text();
        if (/Content Security Policy|CSP|Refused to (load|connect|execute|apply|frame)/i.test(text)) {
          state.csp.push(text);
        }
      });
      page.on("pageerror", (err) => {
        if (/Content Security Policy|CSP/i.test(String(err))) state.csp.push(String(err));
      });
      await use(state);
      expect(state.nonLocal, `non-local requests: ${state.nonLocal.join("; ")}`).toEqual([]);
      expect(state.csp, `CSP violations: ${state.csp.join("; ")}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
