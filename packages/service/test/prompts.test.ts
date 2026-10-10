import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_NAMES } from "@unvibe/shared";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  loadTemplatesDirSync,
  parseTemplate,
  renderTemplate,
  resolvePromptsDir,
  TemplateLoadError,
  TemplateRenderError,
} from "../src/prompts/index.js";

const REPO_PROMPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

function tpl(body: string, variables: string[] = []): string {
  return `---\nrole: user\ntier: main\nvariables: [${variables.join(", ")}]\n---\n\n${body}`;
}

describe("parseTemplate front-matter validation", () => {
  it("parses a minimal template with no variables", () => {
    const t = parseTemplate("demo", tpl("Hello."));
    expect(t.name).toBe("demo");
    expect(t.role).toBe("user");
    expect(t.tier).toBe("main");
    expect(t.variables).toEqual([]);
    expect(t.body).toBe("Hello.");
  });

  it("rejects missing front matter", () => {
    expect(() => parseTemplate("x", "no fence here")).toThrow(TemplateLoadError);
  });

  it("rejects a bad tier, unknown keys and duplicate variables", () => {
    expect(() => parseTemplate("x", `---\nrole: user\ntier: huge\nvariables: []\n---\nbody`)).toThrow(
      /invalid tier/,
    );
    expect(() => parseTemplate("x", `---\nrole: user\ntier: main\nvariables: []\nmoel: x\n---\nbody`)).toThrow(
      /unknown front-matter key/,
    );
    expect(() => parseTemplate("x", tpl("hi", ["a", "a"]))).toThrow(/duplicate variable/);
  });

  it("rejects placeholders that are used but not declared", () => {
    expect(() => parseTemplate("x", tpl("See {{oops}}.", []))).toThrow(/not declared/);
  });

  it("rejects malformed placeholders", () => {
    expect(() => parseTemplate("x", tpl("See {{foo bar}}.", ["foo"]))).toThrow(/malformed placeholder/);
    expect(() => parseTemplate("x", tpl("See {{unclosed.", []))).toThrow(/malformed placeholder/);
  });

  it("supports block-list variables and dotted names", () => {
    const t = parseTemplate("x", `---\nrole: user\ntier: small\nvariables:\n  - anchor.quote\n  - card\n---\n\n{{anchor.quote}} {{card}}`);
    expect(t.variables).toEqual(["anchor.quote", "card"]);
    expect(t.usedVariables).toEqual(["anchor.quote", "card"]);
  });
});

describe("renderTemplate determinism", () => {
  const t = parseTemplate("x", tpl("Q: {{anchor.quote}}\nC: {{card}}\nQ again: {{anchor.quote}}", ["anchor.quote", "card"]));
  const values = { anchor: { quote: "fold?" }, card: "The problem" };

  it("renders twice to the same bytes", () => {
    expect(renderTemplate(t, values)).toBe(renderTemplate(t, values));
    expect(renderTemplate(t, values)).toBe("Q: fold?\nC: The problem\nQ again: fold?");
  });

  it("is independent of input object key order", () => {
    const shuffled = { card: "The problem", anchor: { quote: "fold?" } };
    const nestedShuffled = { anchor: { quote: "fold?" }, card: "The problem" };
    expect(renderTemplate(t, shuffled)).toBe(renderTemplate(t, values));
    expect(renderTemplate(t, nestedShuffled)).toBe(renderTemplate(t, values));
  });

  it("normalises CRLF in values and templates", () => {
    const crlf = parseTemplate("c", "---\nrole: user\ntier: main\nvariables: [v]\n---\r\na: {{v}}\r\nb: done\r\n");
    expect(renderTemplate(crlf, { v: "x\r\ny" })).toBe("a: x\ny\nb: done\n");
  });

  it("lists every missing variable and rejects non-strings; ignores extras", () => {
    expect(() => renderTemplate(t, {})).toThrow(TemplateRenderError);
    try {
      renderTemplate(t, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateRenderError);
      expect((err as TemplateRenderError).missing).toHaveLength(2);
    }
    expect(() => renderTemplate(t, { anchor: { quote: 42 }, card: "x" })).toThrow(/must be a string/);
    expect(renderTemplate(t, { ...values, extra: "ignored" })).toBe(renderTemplate(t, values));
  });
});

describe("repo prompts/ directory", () => {
  it("loads all 18 PRD §13 templates with valid front matter", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    expect([...lib.keys()].sort()).toEqual([...PROMPT_TEMPLATE_NAMES].sort());
    for (const name of PROMPT_TEMPLATE_NAMES) {
      const t = lib.get(name);
      expect(t, name).toBeDefined();
      expect(t?.role.length).toBeGreaterThan(0);
      // Every used placeholder is declared (enforced by the loader).
      expect(t?.usedVariables.every((v) => t.variables.includes(v))).toBe(true);
    }
  });

  it("resolvePromptsDir finds the repo prompts from the service package", () => {
    const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(resolvePromptsDir(serviceDir)).toBe(REPO_PROMPTS);
  });
});
