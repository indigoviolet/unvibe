/**
 * Strict Content-Security-Policy (PRD §16 Privacy).
 *
 * Unvibe's own code (service + web app) must contact nothing but
 * 127.0.0.1. Links the user clicks to github.com are navigations and stay
 * allowed (marked `rel="noreferrer noopener"` in the UI); the policy below
 * only governs subresource loads and connections initiated by our code:
 *
 * - `default-src 'self'`: nothing remote by default.
 * - `connect-src 'self'`: API + same-origin WebSocket only. No remote
 *   `fetch`/WS from our code (`gh`/agent CLIs use their own processes).
 * - `script-src 'self'`: no remote scripts, no `unsafe-inline` (the app
 *   shell and the offline page load scripts from files only).
 * - `style-src 'self' 'unsafe-inline'`: Mermaid injects inline `<style>`
 *   tags at runtime when it renders diagrams, and the offline page carries
 *   a small inline `<style>` block. Scoped to styles only; scripts stay
 *   strict. No remote stylesheets (fonts are self-hosted via @fontsource).
 * - `font-src 'self' data:`: self-hosted woff2 + data: fallbacks only.
 * - `img-src 'self' data: blob:`: icons/manifest (self) plus data:/blob:
 *   where Mermaid or icons truly need it. No remote images.
 * - `form-action 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`:
 *   no exfiltration via forms/frames/base.
 *
 * Served as a header on the HTML shell by `server.ts`; mirrored as a
 * `<meta>` in `packages/web/public/start.html` for the offline page (which
 * is served from the service-worker cache with no headers when the service
 * is down). Keep the two in sync (see `network-guards.test.ts`).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");
