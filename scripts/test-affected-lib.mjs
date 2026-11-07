/**
 * Pure selection helpers for `mise run test:affected` (issue #358).
 *
 * Playwright's `--only-changed=<base>` follows the runner-side static
 * import graph (spec file -> helpers it imports). It cannot see
 * dependencies that only exist at runtime or in the browser:
 *
 * - `fixtures/urllib3-5020/*` is read with `fs` (seeded-demo journeys,
 *   replay recordings) or baked into bundles (`snapshot.json?raw` in the
 *   mock bundle served to every mock-mode spec, `dist-demo` for the
 *   static demo specs);
 * - `packages/shared/src/data-format.ts` reaches specs only as the
 *   compiled `dist` path (`@unvibe/shared`), never the changed src path;
 * - `prompts/*` gate replay matching by prompt markers at runtime;
 * - `packages/web/src/styles/*` and `packages/web/src/ui/*` ship only
 *   in the browser bundle, which no spec imports.
 *
 * TRIGGER_TABLE maps those blind spots: which changed-path prefixes pull
 * in which extra specs, and why. `selectTriggerSpecs` applies the table
 * to a list of changed repo-relative paths plus a spec catalog
 * ({ file, text }); the caller (`scripts/test-affected.mjs`) builds the
 * catalog by scanning `packages/web/e2e/` for `*.spec.ts` files, so newly added
 * specs are picked up without touching this table.
 *
 * No fs, no git, no `process` here: everything is a pure function of its
 * arguments, covered by `packages/service/test/test-affected.test.ts`.
 * macOS + Linux: paths are normalised to posix (`/`) before matching.
 */

/** Branch that folds land on: the base defaults to `merge-base HEAD <this>`. */
export const DEFAULT_BASE_BRANCH = "main-rc";

/** `fixtures/` + the static-demo entry that bakes the fixture in. */
const DEMO_PATHS = ["fixtures/", "packages/web/src/demo.ts"];

/** Normalize a repo-relative path to posix form for prefix matching. */
export function normalizeRel(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True for spec files (helpers like journey-helpers.ts are never run directly). */
export function isSpecFile(file) {
  const f = normalizeRel(file);
  return f.endsWith(".spec.ts") && !f.endsWith(".disabled.spec.ts");
}

/** `packages/web/e2e/*.spec.ts` (not a journey): runs against mock mode or the static bundle. */
export function isTopLevelSpec(file) {
  const f = normalizeRel(file);
  return (
    isSpecFile(f) && f.startsWith("packages/web/e2e/") && !f.includes("/journeys/")
  );
}

const REPLAY_RE = /agent:\s*["']replay["']/;
const SEEDED_RE =
  /createSeededDemoReview|createDemoReview|DEMO_FIXTURE|GUIDE_FIXTURE|D2_FIXTURE/;
const STATIC_DEMO_RE = /dist-demo|startStaticServer/;
const SERVICE_HARNESS_RE = /service-harness/;
const DATA_RESET_RE = /DATA_FORMAT|data-reset|reset-data/;

/** Boots the real service in replay mode (recordings match by prompt markers). */
export function usesReplay(text) {
  return REPLAY_RE.test(text);
}

/** Seeds its review straight from `fixtures/urllib3-5020/snapshot.json`. */
export function usesSeededDemo(text) {
  return SEEDED_RE.test(text);
}

/** Serves `dist-demo` (which bakes the fixture in) over a static server. */
export function usesStaticDemo(text) {
  return STATIC_DEMO_RE.test(text);
}

/** Boots the built service as a subprocess (real-service spec). */
export function usesServiceHarness(text) {
  return SERVICE_HARNESS_RE.test(text);
}

/**
 * Mock-mode spec: top-level, no real service. The mock API bundle it loads
 * is built from `fixtures/urllib3-5020/snapshot.json`
 * (`packages/web/src/mock/guide.ts` imports it), so any fixture change
 * can shift the guide text, citations or counts these specs assert.
 */
export function isMockModeSpec(file, text) {
  return (
    isTopLevelSpec(file) && !usesServiceHarness(text) && !usesStaticDemo(text)
  );
}

/** Asserts on DATA_FORMAT / the data-reset notice. */
export function usesDataReset(text) {
  return DATA_RESET_RE.test(text);
}

/**
 * Visual-tour spec (screenshots + layout checks the owner reviews).
 *
 * The tour lives in `packages/web/e2e/tour/` (#363, package D): frame
 * capture never runs in the gate, only on demand via `mise run
 * visual-tour`. `selectTriggerSpecs` therefore never selects tour specs
 * — a styles/UI change is verified by re-running the tour by hand, and
 * the tour files below only document the blind spot in `why` text.
 */
export function isVisualTourSpec(file) {
  const f = normalizeRel(file);
  return isSpecFile(file) && (f.includes("visual-tour") || f.includes("e2e/tour/"));
}

/**
 * The trigger table: one row per import-graph blind spot.
 * `paths` are repo-relative posix prefixes; a changed path matches when
 * it equals a prefix or starts with it. `select` sees (file, text) and
 * decides whether the spec is pulled in.
 */
export const TRIGGER_TABLE = [
  {
    key: "demo-fixture",
    title: "demo fixture / static-demo entry",
    paths: [...DEMO_PATHS],
    why: "read with fs (seeded journeys, replay recordings) or baked into the mock bundle (snapshot.json?raw) and dist-demo: invisible to the runner import graph",
    select: (file, text) =>
      usesStaticDemo(text) ||
      usesReplay(text) ||
      usesSeededDemo(text) ||
      isMockModeSpec(file, text),
  },
  {
    key: "mock-api",
    title: "in-browser mock API",
    paths: ["packages/web/src/mock/"],
    why: "mock-mode specs load this bundle in the browser; no spec imports web/src",
    select: (file, text) => isMockModeSpec(file, text),
  },
  {
    key: "data-format",
    title: "stored-data format",
    paths: ["packages/shared/src/data-format.ts"],
    why: "specs import @unvibe/shared (dist path), never the changed src path",
    select: (_file, text) => usesDataReset(text),
  },
  {
    key: "prompts",
    title: "prompt templates / replay matching",
    paths: [
      "prompts/",
      "packages/shared/src/replay-match.ts",
      "packages/shared/src/prompts.ts",
    ],
    why: "replay recordings match by prompt markers at runtime (prompt goldens run under check)",
    select: (_file, text) => usesReplay(text),
  },
  {
    key: "styles-ui",
    title: "styles / shared UI components",
    paths: ["packages/web/src/styles/", "packages/web/src/ui/"],
    why: "ships only in the browser bundle, which no spec imports; the tour owns layout",
    select: (file) => isVisualTourSpec(file),
  },
];

/** True when the changed path falls under one of the row's prefixes. */
export function rowMatches(row, changedPath) {
  const p = normalizeRel(changedPath);
  return row.paths.some((prefix) => p === prefix || p.startsWith(prefix));
}

/**
 * Apply the trigger table.
 *
 * @param {string[]} changedPaths repo-relative paths (any separator)
 * @param {{file: string, text: string}[]} catalog spec files + contents
 * @returns {{file: string, reasons: string[]}[]} sorted by file; `file`
 *   echoes the catalog path so the caller can map it to a runner path.
 */
export function selectTriggerSpecs(changedPaths, catalog) {
  const matchedRows = new Set();
  for (const p of changedPaths) {
    for (const row of TRIGGER_TABLE) {
      if (rowMatches(row, p)) matchedRows.add(row);
    }
  }
  if (matchedRows.size === 0) return [];
  const out = [];
  for (const { file, text } of catalog) {
    if (!isSpecFile(file)) continue;
    // The tour is on-demand only (`mise run visual-tour`): never pull
    // its specs into the affected gate run, whatever changed (#363).
    if (isVisualTourSpec(file)) continue;
    const reasons = [];
    for (const row of matchedRows) {
      let hit = false;
      try {
        hit = row.select(file, text ?? "");
      } catch {
        hit = false;
      }
      if (hit) reasons.push(`${row.title}: ${row.why}`);
    }
    if (reasons.length > 0) out.push({ file: normalizeRel(file), reasons });
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}

/**
 * Map a repo-relative spec path to the path Playwright takes when run
 * from `packages/web` (e.g. `packages/web/e2e/journeys/x.spec.ts` ->
 * `e2e/journeys/x.spec.ts`).
 */
export function toRunnerPath(file) {
  const f = normalizeRel(file);
  return f.startsWith("packages/web/") ? f.slice("packages/web/".length) : f;
}
