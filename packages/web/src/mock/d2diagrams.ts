/**
 * Mock D2 diagram SVGs (web-guide owner).
 *
 * Stand-ins until the real pre-rendered fixture SVGs land at
 * `fixtures/urllib3-5020/diagrams/<hash>.light.svg` / `.dark.svg` (the
 * service agent renders those with the real `d2` binary). Everything mock
 * D2 lives in this one file so the merge replaces it trivially: swap each
 * `STAND_INS` value for a `?raw` import of the corresponding fixture file.
 *
 * Every stand-in honours the endpoint contract: cited shapes are wrapped in
 * `<a href="#" data-refs="<token>" data-src="<token>">` (plus
 * `data-unverified="true"` when unverified), and light/dark differ so
 * theme-switch tests can tell them apart.
 */
import type { DiagramBlock } from "@unvibe/shared";

function standIn(kind: "flow" | "added", theme: "light" | "dark"): string {
  const dark = theme === "dark";
  const bg = dark ? "#191d23" : "#ffffff";
  const box = dark ? "#20252d" : "#f7f8fe";
  const edge = dark ? "#56c2cb" : "#0d32b2";
  const ink = dark ? "#e5e8ed" : "#0a0f25";
  const title = kind === "flow" ? "unfold (mock)" : "added (mock)";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 150" data-mock-theme="${theme}">` +
    `<style>.d2mock-box{fill:${box};stroke:${edge};stroke-width:1.5;}.d2mock-t{fill:${ink};font:12px sans-serif;}</style>` +
    `<rect x="0" y="0" width="340" height="150" fill="${bg}"/>` +
    `<a href="#" data-refs="diff:src-urllib3-connection.py:80-82" data-src="diff:src-urllib3-connection.py:80-82">` +
    `<rect id="d2mock-a" class="d2mock-box" x="12" y="45" width="130" height="60" rx="6"/>` +
    `<text class="d2mock-t" x="24" y="80">${title}</text></a>` +
    `<a href="#" data-refs="diff:src-urllib3-connection.py:91-110" data-src="diff:src-urllib3-connection.py:91-110" data-unverified="true">` +
    `<rect id="d2mock-b" class="d2mock-box" x="198" y="45" width="130" height="60" rx="6"/>` +
    `<text class="d2mock-t" x="210" y="80">dict ${theme}</text></a>` +
    `<path d="M142 75 H198" stroke="${edge}" stroke-width="1.5" fill="none"/></svg>`
  );
}

/** hash → per-theme SVG text, mirroring the fixture file layout. */
export const STAND_INS: Record<string, { light: string; dark: string }> = {
  "mock-d2-flow": { light: standIn("flow", "light"), dark: standIn("flow", "dark") },
  "mock-d2-added": { light: standIn("added", "light"), dark: standIn("added", "dark") },
};

/** Serve a stand-in like the endpoint would (200 text / 404 unknown hash). */
export function mockDiagramSvg(hash: string, theme: "light" | "dark"): string {
  const found = STAND_INS[hash];
  if (!found) throw new Error(`GET /api/reviews/demo/diagrams/${hash}: 404 {"error":"unknown diagram"}`);
  return theme === "dark" ? found.dark : found.light;
}

const D2_SOURCE = "unfold: \"folded value\" {\n  link: \"diff:src-urllib3-connection.py:80-82\"\n}\ndict: \"HTTPHeaderDict\" {\n  link: \"diff:src-urllib3-connection.py:91-110\"\n}\nunfold -> dict: \"normalize\"\n";

/** D2 block the mock seeds into the go-deeper flow card (render ok). */
export function mockSeedD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b-mock-d2-flow",
    source: D2_SOURCE,
    caption: "Mock D2 diagram: unfolding before interpretation.",
    citations: [
      { target: "diff:src-urllib3-connection.py:80-82" },
      { target: "diff:src-urllib3-connection.py:91-110", unverified: true },
    ],
    render: { hash: "mock-d2-flow", status: "ok" },
  };
}

/** D2 block with no binary behind it (source fallback + Settings note). */
export function mockUnavailableD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b-mock-d2-unavailable",
    source: "needs-binary: \"a diagram\" {\n  link: \"diff:src-urllib3-connection.py:80-82\"\n}\n",
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: {
      hash: "mock-d2-unavailable",
      status: "unavailable",
      error: "The d2 binary was not found on the service machine.",
    },
  };
}

/** D2 block that `Add diagram` inserts in mock mode (stand-in render). */
export function mockAddedD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: `b-mock-dg-${Date.now().toString(36)}`,
    source: D2_SOURCE,
    caption: "Mock diagram: unfolding before interpretation.",
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: "mock-d2-added", status: "ok" },
  };
}
