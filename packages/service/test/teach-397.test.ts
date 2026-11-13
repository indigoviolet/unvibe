/**
 * The built-in Teach persona (issue #397): a teaching-oriented Guide
 * whose prompt fork lives in `prompts/personas/teach/` (issue #393).
 * Pure checks against the repo's own prompts: the fork loads (its
 * template variables match the base), it is guide-capable, its
 * manifest is current, and the inline seed lens matches the file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEACH_PERSONA, TEACH_PERSONA_ID } from "@unvibe/shared";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import {
  forkDrift,
  forkedTemplateNames,
  isGuideCapable,
  loadPersonaLibrarySync,
} from "../src/prompts/personas.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");

describe("Teach persona (#397)", () => {
  it("forks instructions and reader, and is guide-capable", () => {
    const shared = loadTemplatesDirSync(REPO_PROMPTS);
    expect(forkedTemplateNames(shared, REPO_PROMPTS, TEACH_PERSONA_ID)).toEqual(["instructions", "reader"]);
    expect(isGuideCapable(REPO_PROMPTS, TEACH_PERSONA_ID)).toBe(true);
  });

  it("loads: the forked templates keep the base variables and replace the shared ones", () => {
    const shared = loadTemplatesDirSync(REPO_PROMPTS);
    const teach = loadPersonaLibrarySync(REPO_PROMPTS, TEACH_PERSONA_ID);
    for (const name of ["instructions", "reader"]) {
      expect(teach.get(name)?.variables).toEqual(shared.get(name)?.variables);
      expect(teach.get(name)?.body).not.toBe(shared.get(name)?.body);
    }
    expect(teach.get("reader")?.body).toContain("building blocks");
    expect(teach.get("instructions")?.body).toContain("## How to teach");
    // Templates the fork does not hold fall back to the shared ones.
    expect(teach.get("slower")?.body).toBe(shared.get("slower")?.body);
  });

  it("keeps the reader's fixed card titles, so card ids stay stable", () => {
    const reader = loadPersonaLibrarySync(REPO_PROMPTS, TEACH_PERSONA_ID).get("reader")?.body ?? "";
    for (const title of ["The problem", "The central idea", "How it's built up", "Decisions and questions"]) {
      expect(reader).toContain(title);
    }
  });

  it("its manifest is current (no drift against the base prompts)", () => {
    expect(forkDrift(REPO_PROMPTS, TEACH_PERSONA_ID)).toEqual([]);
  });

  it("the inline seed lens matches prompts/personas/teach/lens.md", () => {
    const raw = fs.readFileSync(path.join(REPO_PROMPTS, "personas", "teach", "lens.md"), "utf8");
    // Drop the file's `# …` title heading; the seed starts at the lens body.
    const fileBody = raw.split("\n").slice(2).join("\n");
    const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();
    expect(normalize(TEACH_PERSONA.lens)).toBe(normalize(fileBody));
  });
});
