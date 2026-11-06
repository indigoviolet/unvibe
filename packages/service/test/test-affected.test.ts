/**
 * Trigger mapping + spec selection for `mise run test:affected`
 * (issue #358). Pure `scripts/test-affected-lib.mjs` units: no git, no
 * fs, no network. The catalog entries below mimic the real markers the
 * runner scans for (replay agent mode, seeded-demo helpers, dist-demo,
 * DATA_FORMAT, service-harness, visual-tour paths).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_BRANCH,
  TRIGGER_TABLE,
  isMockModeSpec,
  isSpecFile,
  isTopLevelSpec,
  isVisualTourSpec,
  normalizeRel,
  rowMatches,
  selectTriggerSpecs,
  toRunnerPath,
  usesDataReset,
  usesReplay,
  usesSeededDemo,
  usesServiceHarness,
  usesStaticDemo,
} from "../../../scripts/test-affected-lib.mjs";

const GUIDE_SPEC = "packages/web/e2e/guide.spec.ts";
const INTERACTION_SPEC = "packages/web/e2e/interaction.spec.ts";
const STATIC_DEMO_SPEC = "packages/web/e2e/static-demo.spec.ts";
const DEMO_BANNER_SPEC = "packages/web/e2e/demo-banner.spec.ts";
const SYNC_SPEC = "packages/web/e2e/static-demo-sync.spec.ts";
const J1_SPEC = "packages/web/e2e/journeys/j1-open-and-read.spec.ts";
const J311_SPEC = "packages/web/e2e/journeys/j311-data-reset.spec.ts";
const J5_SPEC = "packages/web/e2e/journeys/j5-settings-versions.spec.ts";
const TOUR_SPEC = "packages/web/e2e/visual-tour.spec.ts";
const COMMENTS_SPEC = "packages/web/e2e/comments.spec.ts";

function catalog() {
  return [
    { file: GUIDE_SPEC, text: `import { test } from "./network-guard.js";\ntest("guide", () => {});` },
    { file: INTERACTION_SPEC, text: `import { test } from "./network-guard.js";` },
    {
      file: STATIC_DEMO_SPEC,
      text: `import { startStaticServer } from "./static-server.js";\nconst DEMO_DIST = "dist-demo";`,
    },
    {
      file: DEMO_BANNER_SPEC,
      text: `import { startStaticServer } from "./static-server.js";`,
    },
    {
      file: SYNC_SPEC,
      text: `import { startService } from "./service-harness.js";\nstartService(dir, { agent: "replay" });`,
    },
    {
      file: J1_SPEC,
      text: `import { startService } from "../service-harness.js";\nstartService(dir, { agent: "replay" });`,
    },
    {
      file: J311_SPEC,
      text: `// DATA_FORMAT 4 after #351 step 2.\nstartService(dir, { agent: "replay" });`,
    },
    {
      file: J5_SPEC,
      text: `page.locator('[data-testid="update-data-reset-warning"]');`,
    },
    { file: TOUR_SPEC, text: `import { startService } from "./service-harness.js";` },
    {
      file: COMMENTS_SPEC,
      text: `import { startService } from "./service-harness.js";\nstartService(dir, { agent: "none" });`,
    },
    // Helpers are never selected, even when they match a marker.
    {
      file: "packages/web/e2e/journeys/journey-helpers.ts",
      text: `export const DATA_FORMAT = 1;`,
    },
  ];
}

describe("markers", () => {
  it("classifies spec files, skipping helpers and disabled specs", () => {
    expect(isSpecFile(GUIDE_SPEC)).toBe(true);
    expect(isSpecFile("packages/web/e2e/journeys/journey-helpers.ts")).toBe(false);
    expect(isSpecFile("packages/web/e2e/foo.disabled.spec.ts")).toBe(false);
  });

  it("treats top-level specs without a service as mock-mode", () => {
    expect(isTopLevelSpec(GUIDE_SPEC)).toBe(true);
    expect(isTopLevelSpec(J1_SPEC)).toBe(false);
    expect(isMockModeSpec(GUIDE_SPEC, "test()")).toBe(true);
    expect(isMockModeSpec(COMMENTS_SPEC, "service-harness")).toBe(false);
    expect(isMockModeSpec(STATIC_DEMO_SPEC, "dist-demo")).toBe(false);
  });

  it("matches the real markers (replay, seeded demo, static demo, reset, tour)", () => {
    expect(usesReplay(`startService(dir, { agent: "replay" })`)).toBe(true);
    expect(usesReplay(`startService(dir, { agent: "none" })`)).toBe(false);
    expect(usesSeededDemo("createSeededDemoReview(dataDir)")).toBe(true);
    expect(usesStaticDemo("startStaticServer(DEMO_DIST)")).toBe(true);
    expect(usesServiceHarness(`from "./service-harness.js"`)).toBe(true);
    expect(usesDataReset("update-data-reset-warning")).toBe(true);
    expect(usesDataReset("plain spec")).toBe(false);
    expect(isVisualTourSpec(TOUR_SPEC)).toBe(true);
    expect(isVisualTourSpec(GUIDE_SPEC)).toBe(false);
  });

  it("normalizes separators and maps to runner paths", () => {
    expect(normalizeRel("packages\\web\\e2e\\a.spec.ts")).toBe("packages/web/e2e/a.spec.ts");
    expect(toRunnerPath(J1_SPEC)).toBe("e2e/journeys/j1-open-and-read.spec.ts");
  });
});

describe("TRIGGER_TABLE", () => {
  it("documents one row per blind spot with paths and reasons", () => {
    const keys = TRIGGER_TABLE.map((r) => r.key).sort();
    expect(keys).toEqual(["data-format", "demo-fixture", "mock-api", "prompts", "styles-ui"]);
    for (const row of TRIGGER_TABLE) {
      expect(row.paths.length).toBeGreaterThan(0);
      expect(row.why).toMatch(/./);
    }
  });

  it("matches changed paths by prefix", () => {
    const fixtures = TRIGGER_TABLE.find((r) => r.key === "demo-fixture")!;
    expect(rowMatches(fixtures, "fixtures/urllib3-5020/snapshot.json")).toBe(true);
    expect(rowMatches(fixtures, "packages/web/src/demo.ts")).toBe(true);
    expect(rowMatches(fixtures, "packages/web/src/guide.ts")).toBe(false);
  });
});

describe("selectTriggerSpecs", () => {
  it("a fixture change pulls demo, mock-mode and replay specs (with reasons)", () => {
    const out = selectTriggerSpecs(["fixtures/urllib3-5020/snapshot.json"], catalog());
    const files = out.map((s) => s.file);
    expect(files).toContain(STATIC_DEMO_SPEC);
    expect(files).toContain(DEMO_BANNER_SPEC);
    expect(files).toContain(SYNC_SPEC);
    expect(files).toContain(GUIDE_SPEC);
    expect(files).toContain(INTERACTION_SPEC);
    expect(files).toContain(J1_SPEC);
    expect(files).toContain(J311_SPEC);
    // Untouched lanes stay out.
    expect(files).not.toContain(TOUR_SPEC);
    expect(files).not.toContain(COMMENTS_SPEC);
    expect(files).not.toContain("packages/web/e2e/journeys/journey-helpers.ts");
    for (const s of out) expect(s.reasons.length).toBeGreaterThan(0);
    expect(out).toEqual([...out].sort((a, b) => (a.file < b.file ? -1 : 1)));
  });

  it("a style change pulls only the visual tour", () => {
    const out = selectTriggerSpecs(["packages/web/src/styles/tokens.css"], catalog());
    expect(out.map((s) => s.file)).toEqual([TOUR_SPEC]);
  });

  it("a shared-ui change pulls only the visual tour", () => {
    const out = selectTriggerSpecs(["packages/web/src/ui/TopBar.tsx"], catalog());
    expect(out.map((s) => s.file)).toEqual([TOUR_SPEC]);
  });

  it("a data-format change pulls the reset specs", () => {
    const out = selectTriggerSpecs(["packages/shared/src/data-format.ts"], catalog());
    const files = out.map((s) => s.file);
    expect(files).toContain(J311_SPEC);
    expect(files).toContain(J5_SPEC);
    expect(files).not.toContain(GUIDE_SPEC);
  });

  it("a prompts change pulls the replay specs", () => {
    const out = selectTriggerSpecs(["prompts/ask.md"], catalog());
    const files = out.map((s) => s.file);
    expect(files).toContain(J1_SPEC);
    expect(files).toContain(J311_SPEC);
    expect(files).toContain(SYNC_SPEC);
    expect(files).not.toContain(GUIDE_SPEC);
    expect(files).not.toContain(TOUR_SPEC);
  });

  it("a service-only change pulls nothing (small Playwright subset)", () => {
    expect(selectTriggerSpecs(["packages/service/src/reviews.ts"], catalog())).toEqual([]);
  });

  it("no changes pulls nothing", () => {
    expect(selectTriggerSpecs([], catalog())).toEqual([]);
  });

  it("accumulates reasons across rows", () => {
    const out = selectTriggerSpecs(
      ["fixtures/urllib3-5020/snapshot.json", "prompts/ask.md"],
      catalog(),
    );
    const j1 = out.find((s) => s.file === J1_SPEC)!;
    expect(j1.reasons.length).toBe(2);
  });
});

describe("DEFAULT_BASE_BRANCH", () => {
  it("folds land on main-rc", () => {
    expect(DEFAULT_BASE_BRANCH).toBe("main-rc");
  });
});
