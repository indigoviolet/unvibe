/**
 * Mock D2 diagram SVGs (web-guide owner): the pre-rendered fixture renders
 * at `fixtures/urllib3-5020/diagrams/<hash>.<theme>.svg`, served by hash
 * exactly like the endpoint serves its cache. The fixture has no
 * `unavailable` diagram and no unverified anchor, so two hand-made
 * stand-ins remain for exactly those edge cases (mock Add-diagram inserts
 * and the unverified-dimming test); everything else is a real render.
 */
import type { DiagramBlock, DiagramTheme } from "@unvibe/shared";
import { DiagramStatusError } from "../api/diagram.js";
// `?raw` keeps the SVGs out of TS's NodeNext import-attribute rules.
import flowLight from "../../../../fixtures/urllib3-5020/diagrams/f23beae236cc0685.light.svg?raw";
import flowDark from "../../../../fixtures/urllib3-5020/diagrams/f23beae236cc0685.dark.svg?raw";
import pathLight from "../../../../fixtures/urllib3-5020/diagrams/5897a4452ede567b.light.svg?raw";
import pathDark from "../../../../fixtures/urllib3-5020/diagrams/5897a4452ede567b.dark.svg?raw";
import foldLight from "../../../../fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.light.svg?raw";
import foldDark from "../../../../fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.dark.svg?raw";

/** Stand-in for cases the fixtures cannot cover (see module docs). */
function standIn(theme: DiagramTheme): string {
  const dark = theme === "dark";
  const bg = dark ? "#191d23" : "#ffffff";
  const box = dark ? "#20252d" : "#f7f8fe";
  const edge = dark ? "#56c2cb" : "#0d32b2";
  const ink = dark ? "#e5e8ed" : "#0a0f25";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 150" data-mock-theme="${theme}">` +
    `<style>.d2mock-box{fill:${box};stroke:${edge};stroke-width:1.5;}.d2mock-t{fill:${ink};font:12px sans-serif;}</style>` +
    `<rect x="0" y="0" width="340" height="150" fill="${bg}"/>` +
    `<a href="#" data-refs="diff:src-urllib3-connection.py:80-82" data-src="diff:src-urllib3-connection.py:80-82">` +
    `<rect id="d2mock-a" class="d2mock-box" x="12" y="45" width="130" height="60" rx="6"/>` +
    `<text class="d2mock-t" x="24" y="80">added (mock)</text></a>` +
    `<a href="#" data-refs="diff:src-urllib3-connection.py:91-110" data-src="diff:src-urllib3-connection.py:91-110" data-unverified="true">` +
    `<rect id="d2mock-b" class="d2mock-box" x="198" y="45" width="130" height="60" rx="6"/>` +
    `<text class="d2mock-t" x="210" y="80">dict ${theme}</text></a>` +
    `<path d="M142 75 H198" stroke="${edge}" stroke-width="1.5" fill="none"/></svg>`
  );
}

/** hash → per-theme SVG text, mirroring the fixture file layout. */
const BY_HASH: Record<string, { light: string; dark: string }> = {
  f23beae236cc0685: { light: flowLight, dark: flowDark },
  "5897a4452ede567b": { light: pathLight, dark: pathDark },
  d604f9a8e9fb637c: { light: foldLight, dark: foldDark },
  "mock-d2-added": { light: standIn("light"), dark: standIn("dark") },
  "mock-d2-unverified": { light: standIn("light"), dark: standIn("dark") },
  "mock-d2-multiline": { light: multiline("light"), dark: multiline("dark") },
};

/**
 * Stand-in shaped like real d2 output for multi-line labels (#16): two-
 * and three-line shapes position lines via tspan x/dy, and the edge
 * clears the line behind its label via a userSpaceOnUse mask. Exercises
 * the full adopt path (id namespacing rewrites the mask url consistently).
 */
function multiline(theme: DiagramTheme): string {
  const dark = theme === "dark";
  const bg = dark ? "#191d23" : "#ffffff";
  const box = dark ? "#20252d" : "#f7f8fe";
  const edge = dark ? "#56c2cb" : "#0d32b2";
  const ink = dark ? "#e5e8ed" : "#0a0f25";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 220" data-mock-theme="${theme}">` +
    `<defs><mask id="d2mock-ml-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="460" height="220">` +
    `<rect x="0" y="0" width="460" height="220" fill="white"/>` +
    `<rect x="180" y="100" width="120" height="20" fill="black"/></mask></defs>` +
    `<rect x="0" y="0" width="460" height="220" fill="${bg}"/>` +
    `<a href="#" data-refs="diff:src-urllib3-connection.py:80-82" data-src="diff:src-urllib3-connection.py:80-82">` +
    `<rect x="20" y="30" width="180" height="80" rx="6" fill="${box}" stroke="${edge}" stroke-width="2" class="stroke-B1 fill-B6"/>` +
    `<text x="110" y="58" fill="${ink}" class="fill-N1" style="text-anchor:middle;font-size:16px">` +
    `<tspan x="110" dy="0">first line</tspan><tspan x="110" dy="18.5">second line</tspan></text></a>` +
    `<rect x="260" y="20" width="180" height="90" rx="6" fill="${box}" stroke="${edge}" stroke-width="2" class="stroke-B1 fill-B6"/>` +
    `<text x="350" y="44" fill="${ink}" class="fill-N1" style="text-anchor:middle;font-size:16px">` +
    `<tspan x="350" dy="0">one</tspan><tspan x="350" dy="17.6">two</tspan><tspan x="350" dy="17.6">three</tspan></text>` +
    `<path d="M 200 150 H 440" stroke="${edge}" stroke-width="2" fill="none" class="connection stroke-B1" mask="url(#d2mock-ml-mask)"/>` +
    `<text x="240" y="113" fill="${ink}" style="text-anchor:middle;font-size:14px;font-style:italic">edge label</text></svg>`
  );
}

/**
 * Serve SVGs like the endpoint would: 200 text for known hashes, a typed
 * 409 for the binary-missing stand-in, and a 404 error otherwise.
 */
export function mockDiagramSvg(hash: string, theme: DiagramTheme): string {
  if (hash === "mock-d2-unavailable") {
    throw new DiagramStatusError("unavailable", "The d2 binary was not found on the service machine.");
  }
  if (hash === "mock-d2-error") {
    // A source d2 ran and rejected: the raw message is for the Debug
    // page, never quoted in the reader-facing fallback (#130).
    throw new DiagramStatusError("error", "err: 7:37: invalid text beginning unquoted key");
  }
  const found = BY_HASH[hash];
  if (!found) throw new Error(`GET /api/reviews/demo/diagrams/${hash}: 404 {"error":"unknown diagram"}`);
  return theme === "dark" ? found.dark : found.light;
}

const ADDED_SOURCE =
  "unfold: \"folded value\" {\n  link: \"diff:src-urllib3-connection.py:80-82\"\n}\n" +
  "dict: \"HTTPHeaderDict\" {\n  link: \"diff:src-urllib3-connection.py:91-110\"\n}\n" +
  "unfold -> dict: \"normalize\"\n";

/** Edge-case D2 block the mock seeds (unverified anchor + dimming test). */
export function mockSeedD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b-mock-d2-edge",
    source: ADDED_SOURCE,
    caption: "Mock D2 edge cases: unverified citation.",
    citations: [
      { target: "diff:src-urllib3-connection.py:80-82" },
      { target: "diff:src-urllib3-connection.py:91-110", unverified: true },
    ],
    render: { hash: "mock-d2-unverified", status: "ok" },
  };
}

/** D2 block whose source failed to compile (plain fallback + retry, #130). */
export function mockErrorD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b-mock-d2-error",
    source: 'gone: "unmount cleanup" {.class: [bad]}',
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: {
      hash: "mock-d2-error",
      status: "error",
      error: "err: 7:37: invalid text beginning unquoted key",
    },
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
    source: ADDED_SOURCE,
    caption: "Mock diagram: unfolding before interpretation.",
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: "mock-d2-added", status: "ok" },
  };
}

/** D2 block with multi-line shape labels (line-layout regression test). */
export function mockMultilineD2Block(): DiagramBlock {
  return {
    type: "diagram",
    id: "b-mock-d2-multiline",
    source: "two: \"first line\\nsecond line\"\nthree: \"one\\ntwo\\nthree\"\ntwo -> three: \"edge label\"\n",
    caption: "Mock D2 multi-line labels.",
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: "mock-d2-multiline", status: "ok" },
  };
}
