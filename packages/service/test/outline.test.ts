/**
 * Outline rules (issue #133, stage 2): unit chains over small fixtures
 * with the real grammars (no network, no agents), plus degradation for
 * unknown languages, broken syntax, minified and oversize files.
 */
import { describe, expect, it } from "vitest";
import { languageOf, outlineLanguages } from "../src/outline/grammars.js";
import { enclosingUnits, outlineCacheStats, resetOutlineForTests } from "../src/outline/outline.js";
import { resetGrammarsForTests } from "../src/outline/grammars.js";

const PY = [
  "# module comment",
  "",
  "",
  "class Store:",
  '    """Keep things."""',
  "",
  "    def get(self, key):",
  "        return self._data[key]",
  "",
  "    def put(self, key, value):",
  "        self._data[key] = value",
  "",
  "",
  "def helper(items):",
  "    total = 0",
  "    for it in items:",
  "        total += it",
  "    return total",
].join("\n");

const TS = [
  "import { x } from './x';",
  "",
  "export class Cache {",
  "    private data = new Map<string, string>();",
  "",
  "    get(key: string): string | undefined {",
  '        // look it up',
  "        return this.data.get(key);",
  "    }",
  "",
  "    set(key: string, value: string): void {",
  "        this.data.set(key, value);",
  "    }",
  "}",
].join("\n");

describe("outline languages", () => {
  it("maps the eight spike languages by extension", () => {
    expect(languageOf("a.py")).toBe("python");
    expect(languageOf("a.go")).toBe("go");
    expect(languageOf("a.rs")).toBe("rust");
    expect(languageOf("a.java")).toBe("java");
    expect(languageOf("a.rb")).toBe("ruby");
    expect(languageOf("a.js")).toBe("javascript");
    expect(languageOf("a.ts")).toBe("typescript");
    expect(languageOf("a.tsx")).toBe("tsx");
    expect(languageOf("a.md")).toBeNull();
    expect(languageOf("Makefile")).toBeNull();
    expect(outlineLanguages()).toHaveLength(8);
  });
});

describe("enclosingUnits with grammars", () => {
  it("chains a python method up through its class", async () => {
    resetOutlineForTests();
    resetGrammarsForTests();
    const res = await enclosingUnits("src/store.py", PY, 8, 8);
    expect(res.how).toBe("parser");
    expect(res.language).toBe("python");
    expect(res.totalLines).toBe(18);
    expect(res.chain.map((u) => u.name)).toEqual(["get", "Store"]);
    expect(res.chain[0]).toMatchObject({ start: 7, end: 8 });
    // Leading doc comment belongs to the class.
    expect(res.chain[1]).toMatchObject({ start: 4, end: 11 });
  });

  it("chains a typescript method up through its class", async () => {
    const res = await enclosingUnits("src/cache.ts", TS, 8, 8);
    expect(res.how).toBe("parser");
    expect(res.chain.map((u) => u.name)).toEqual(["get", "Cache"]);
    expect(res.chain[0]).toMatchObject({ start: 6, end: 9 });
  });

  it("returns an empty parser chain for a range crossing two definitions", async () => {
    const res = await enclosingUnits("src/store.py", PY, 4, 14);
    expect(res.how).toBe("parser");
    expect(res.chain).toEqual([]);
  });

  it("caches parses by file content hash", async () => {
    resetOutlineForTests();
    await enclosingUnits("src/store.py", PY, 8, 8);
    expect(outlineCacheStats().size).toBe(1);
    await enclosingUnits("src/store.py", PY, 10, 11);
    expect(outlineCacheStats().size).toBe(1);
  });
});

describe("outline degradation", () => {
  it("falls back to the heuristic for unknown languages", async () => {
    const res = await enclosingUnits("notes.txt", ["# Title", "", "def thing():", "    do()"].join("\n"), 4, 4);
    expect(res.language).toBeNull();
    expect(res.how).toBe("heuristic");
    expect(res.chain).toHaveLength(1);
    expect(res.chain[0]).toMatchObject({ kind: "block", start: 3 });
  });

  it("never breaks on a file that fails to parse", async () => {
    const bad = ["def broken(:", "    pass", "", "def fine():", "    return 1"].join("\n");
    const res = await enclosingUnits("src/bad.py", bad, 4, 5);
    expect(["parser", "heuristic", "none"]).toContain(res.how);
    expect(Array.isArray(res.chain)).toBe(true);
    // The intact definition still resolves.
    expect(res.chain.map((u) => u.name)).toContain("fine");
  });

  it("skips minified files", async () => {
    const minified = `var x=${"y".repeat(25_000)};`;
    const res = await enclosingUnits("src/min.js", minified, 1, 1);
    expect(res.how).toBe("none");
    expect(res.chain).toEqual([]);
  });

  it("skips oversize files", async () => {
    const big = `${"x = 1\n".repeat(200_000)}`;
    const res = await enclosingUnits("src/big.py", big, 10, 10);
    expect(res.how).toBe("none");
    expect(res.chain).toEqual([]);
  });
});
