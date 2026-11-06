/**
 * Persona model (issue #349, step 1): validation and the automatic
 * colour sequence.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PERSONA_ID,
  PERSONA_COLORS,
  SECOND_OPINION_PERSONA,
  defaultPersonas,
  isPersonaColor,
  nextPersonaColor,
  personaColorAt,
  slugifyPersonaName,
  validatePersona,
  type Persona,
} from "../src/personas.js";

function valid(over: Partial<Persona> = {}): Persona {
  return {
    id: "perf-sceptic",
    name: "Performance sceptic",
    provider: "codex",
    model: "gpt-6.1-sol",
    lens: "You are a performance sceptic.",
    cardInstruction: "",
    enabled: true,
    color: PERSONA_COLORS[1],
    ...over,
  };
}

describe("validatePersona", () => {
  it("accepts a complete persona", () => {
    expect(validatePersona(valid())).toEqual([]);
  });

  it("requires name, provider, model, lens, enabled and a sequence colour", () => {
    expect(validatePersona(valid({ name: "  " }))).toContain(
      "persona name must be a non-empty string",
    );
    expect(validatePersona(valid({ provider: "" }))).toContain(
      "persona provider must be a non-empty string",
    );
    expect(validatePersona(valid({ model: "" }))).toContain(
      "persona model must be a non-empty string",
    );
    expect(validatePersona(valid({ lens: "" }))).toContain(
      "persona lens must be a non-empty string",
    );
    expect(validatePersona(valid({ enabled: "yes" as unknown as boolean }))).toContain(
      "persona enabled must be a boolean",
    );
    expect(validatePersona(valid({ color: "#ff0000" }))[0]).toMatch(/persona color must be one of/);
  });

  it("allows an empty card instruction (the card default applies)", () => {
    expect(validatePersona(valid({ cardInstruction: "" }))).toEqual([]);
    expect(validatePersona(valid({ cardInstruction: "Check the claims." }))).toEqual([]);
  });

  it("rejects non-objects and blank ids", () => {
    expect(validatePersona(null)).toEqual(["persona must be an object"]);
    expect(validatePersona(valid({ id: "" }))).toContain("persona id must be a non-empty string");
  });
});

describe("persona colours", () => {
  it("the sequence is fixed, non-empty and unique", () => {
    expect(PERSONA_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(PERSONA_COLORS).size).toBe(PERSONA_COLORS.length);
  });

  it("personaColorAt walks the sequence in creation order and wraps", () => {
    expect(personaColorAt(0)).toBe(PERSONA_COLORS[0]);
    expect(personaColorAt(1)).toBe(PERSONA_COLORS[1]);
    expect(personaColorAt(PERSONA_COLORS.length)).toBe(PERSONA_COLORS[0]);
  });

  it("nextPersonaColor returns the first unused colour", () => {
    expect(nextPersonaColor([])).toBe(PERSONA_COLORS[0]);
    expect(nextPersonaColor([{ color: PERSONA_COLORS[0] }])).toBe(PERSONA_COLORS[1]);
    expect(
      nextPersonaColor([{ color: PERSONA_COLORS[1] }, { color: PERSONA_COLORS[0] }]),
    ).toBe(PERSONA_COLORS[2]);
  });

  it("isPersonaColor accepts only sequence colours", () => {
    expect(isPersonaColor(PERSONA_COLORS[0])).toBe(true);
    expect(isPersonaColor("#ff0000")).toBe(false);
    expect(isPersonaColor(undefined)).toBe(false);
  });
});

describe("slugifyPersonaName", () => {
  it("slugifies names", () => {
    expect(slugifyPersonaName("Second opinion")).toBe("second-opinion");
    expect(slugifyPersonaName("  Perf  Sceptic!! ")).toBe("perf-sceptic");
    expect(slugifyPersonaName("")).toBe("persona");
  });
});

describe("built-in Second opinion", () => {
  it("is seeded with the check behaviour in lens + card instruction", () => {
    expect(SECOND_OPINION_PERSONA.id).toBe(BUILT_IN_PERSONA_ID);
    expect(SECOND_OPINION_PERSONA.enabled).toBe(true);
    expect(SECOND_OPINION_PERSONA.lens).toContain("second reader");
    expect(SECOND_OPINION_PERSONA.lens).toContain("hypotheses, not conclusions");
    expect(SECOND_OPINION_PERSONA.cardInstruction).toContain("check its claims against the code");
    expect(SECOND_OPINION_PERSONA.color).toBe(PERSONA_COLORS[0]);
    expect(validatePersona(SECOND_OPINION_PERSONA)).toEqual([]);
  });

  it("defaultPersonas returns a fresh seed list", () => {
    const a = defaultPersonas();
    const b = defaultPersonas();
    expect(a).toEqual([SECOND_OPINION_PERSONA]);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(SECOND_OPINION_PERSONA);
  });
});
