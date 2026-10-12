/**
 * Language detection tests (issue #23).
 */
import { describe, expect, it } from "vitest";
import { detectLanguage, filenameLanguage, SHIPPED_LANGS } from "./language.js";

describe("detectLanguage", () => {
  it("maps common source extensions", () => {
    expect(detectLanguage("src/urllib3/connection.py")).toBe("python");
    expect(detectLanguage("src/a.ts")).toBe("typescript");
    expect(detectLanguage("src/a.tsx")).toBe("tsx");
    expect(detectLanguage("src/a.js")).toBe("javascript");
    expect(detectLanguage("src/a.jsx")).toBe("jsx");
    expect(detectLanguage("pkg/data.json")).toBe("json");
    expect(detectLanguage("docs/guide.md")).toBe("markdown");
    expect(detectLanguage("scripts/run.sh")).toBe("bash");
    expect(detectLanguage("config/settings.yaml")).toBe("yaml");
    expect(detectLanguage("config/settings.yml")).toBe("yaml");
    expect(detectLanguage("web/app.css")).toBe("css");
    expect(detectLanguage("web/page.html")).toBe("html");
    expect(detectLanguage("conf/app.toml")).toBe("toml");
  });

  it("is case-insensitive and path-agnostic", () => {
    expect(detectLanguage("SRC/Foo.PY")).toBe("python");
    expect(detectLanguage("a.TS")).toBe("typescript");
  });

  it("handles exact filenames", () => {
    expect(detectLanguage("Dockerfile")).toBe("bash");
    expect(detectLanguage("docker/Dockerfile.prod")).toBe("bash");
    expect(filenameLanguage("Dockerfile")).toBe("bash");
  });

  it("returns null for unshipped or missing languages (plain render)", () => {
    expect(detectLanguage("changelog/1362.bugfix.rst")).toBeNull();
    expect(detectLanguage("src/main.rs")).toBeNull();
    expect(detectLanguage("src/main.go")).toBeNull();
    expect(detectLanguage("Makefile")).toBeNull();
    expect(detectLanguage("README")).toBeNull();
    expect(detectLanguage(".gitignore")).toBeNull();
    expect(detectLanguage("file.")).toBeNull();
  });

  it("ships a small default set", () => {
    expect(SHIPPED_LANGS.length).toBeLessThanOrEqual(16);
    expect(SHIPPED_LANGS).toContain("python");
    expect(SHIPPED_LANGS).toContain("typescript");
  });
});
