import { describe, expect, it } from "vitest";
import { parseId, PROMPT_TEMPLATE_NAMES, tokenizeLinks } from "@unvibe/shared";
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
  it("loads all 16 PRD §13 templates with valid front matter", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    // Issue #160 adds two `{{access_policy}}` fragments (not §13 table
    // templates) that fill the instructions variant.
    expect([...lib.keys()].sort()).toEqual([...PROMPT_TEMPLATE_NAMES, "access-full", "access-lockdown"].sort());
    for (const name of [...PROMPT_TEMPLATE_NAMES, "access-full", "access-lockdown"]) {
      const t = lib.get(name);
      expect(t, name).toBeDefined();
      expect(t?.role.length).toBeGreaterThan(0);
      // Every used placeholder is declared (enforced by the loader).
      expect(t?.usedVariables.every((v) => t.variables.includes(v))).toBe(true);
    }
    expect(lib.get("access-full")?.variables).toEqual([]);
    expect(lib.get("access-lockdown")?.variables).toEqual([]);
  });

  it("reader prompts describe content, not how to read the guide (#175)", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const reader = lib.get("reader")?.body ?? "";
    const instructions = lib.get("instructions")?.body ?? "";
    expect(reader).toContain("The first paragraph alone states the");
    expect(reader).not.toContain("need to read on");
    expect(instructions).toContain("Never address the reader about how to read the guide");
    expect(instructions).toContain('"TL;DR" framings');
  });

  it("every concrete diff: example in the prompts parses (#124)", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const bodies = [...lib.values()].map((t) => t.body).join("\n");
    // Citation examples appear as [[diff:...]] tokens or D2 link: "diff:...".
    const fromTokens = tokenizeLinks(bodies)
      .map((t) => t.idText)
      .filter((id) => id.startsWith("diff:"));
    const fromLinks = [...bodies.matchAll(/link:\s*"(diff:[^"]+)"/g)].map((m) => m[1]);
    // Placeholders (<fileKey>, diff:...) are grammar templates, not examples.
    const concrete = [...fromTokens, ...fromLinks].filter((id) => !/[<>\u2026]/.test(id));
    expect(concrete.length).toBeGreaterThanOrEqual(4);
    expect(concrete).toContain("diff:conn:650-652");
    expect(concrete).toContain("diff:conn:651");
    for (const id of concrete) {
      expect(parseId(id), id).toMatchObject({ kind: "diff" });
    }
    // The malformed shapes the grammar warns against must not parse.
    const instructions = lib.get("instructions")?.body ?? "";
    for (const bad of ["diff:conn:h111", "diff:src/urllib3/connection.py"]) {
      expect(instructions).toContain(bad);
      expect(parseId(bad), bad).toBeNull();
    }
  });

  it("regularizer prompts: renamed card, Names, critic lens, tool preference (#212/#211)", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const instructions = lib.get("instructions")?.body ?? "";
    const reader = lib.get("reader")?.body ?? "";
    const critic = lib.get("critic")?.body ?? "";
    const accessFull = lib.get("access-full")?.body ?? "";
    const hunk = lib.get("hunk_pass")?.body ?? "";
    const ask = lib.get("ask")?.body ?? "";
    expect(instructions).toContain("system's regularizer");
    expect(instructions).toContain("get_hunk");
    expect(instructions).toContain("never to re-derive the diff");
    expect(reader).toContain("Decisions and questions");
    expect(reader).not.toContain("Decisions and alternatives");
    expect(reader).toContain("Interfaces with reach");
    expect(reader).toContain("Known uncertainties");
    expect(reader).toContain("also stay in `open_questions`");
    expect(reader).toContain("**Names.**");
    expect(reader).toContain("Leave out");
    expect(reader).toContain("private helpers and plumbing");
    expect(reader).toContain("follows its effects");
    expect(reader).toContain("its footprint");
    expect(reader).toContain("never to re-derive the diff");
    expect(critic).toContain("Overfitting");
    expect(critic).toContain("widened interface for one caller");
    expect(critic).toContain("uncertainty becomes a finding only with evidence of risk");
    expect(accessFull).toContain("read and cite the change itself through the");
    expect(accessFull).toContain("never re-derive the diff with `git diff`");
    expect(hunk).toContain('Judge "public API" by reach');
    expect(hunk).toContain("private");
    expect(ask).toContain("connect the local detail to it");
  });

  it("resolvePromptsDir finds the repo prompts from the service package", () => {
    const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(resolvePromptsDir(serviceDir)).toBe(REPO_PROMPTS);
  });
});
