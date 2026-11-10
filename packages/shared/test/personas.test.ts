/**
 * Persona model (issue #349, step 1): validation and the automatic
 * colour sequence.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PERSONA_ID,
  CLARITY_PERSONA,
  CLARITY_PERSONA_ID,
  GUIDE_PERSONA,
  GUIDE_PERSONA_ID,
  PERSONA_COLORS,
  SECOND_OPINION_PERSONA,
  defaultPersonas,
  isPersonaColor,
  nextPersonaColor,
  getGuidePersona,
  personaColorAt,
  slugifyPersonaName,
  validatePersona,
  type Persona,
} from "../src/personas.js";

function valid(over: Partial<Persona> = {}): Persona {
  return {
    id: "perf-sceptic",
    name: "Performance sceptic",
    followMain: false,
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
    expect(validatePersona(valid({ followMain: "yes" as unknown as boolean })))
      .toContain("persona followMain must be a boolean (true = run on the main model)");
    expect(validatePersona(valid({ followMain: undefined as unknown as boolean })))
      .toContain("persona followMain must be a boolean (true = run on the main model)");
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
  it("is seeded with an explicit model", () => {
    expect(SECOND_OPINION_PERSONA.id).toBe(BUILT_IN_PERSONA_ID);
    expect(SECOND_OPINION_PERSONA.followMain).toBe(false);
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
    expect(a).toEqual([GUIDE_PERSONA, SECOND_OPINION_PERSONA, CLARITY_PERSONA]);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(GUIDE_PERSONA);
    expect(a[1]).not.toBe(SECOND_OPINION_PERSONA);
    expect(a[2]).not.toBe(CLARITY_PERSONA);
  });
});

describe("built-in Clarity", () => {
  it("is seeded enabled, following the main model", () => {
    expect(CLARITY_PERSONA.id).toBe(CLARITY_PERSONA_ID);
    expect(CLARITY_PERSONA.id).toBe("clarity");
    expect(CLARITY_PERSONA.name).toBe("Clarity");
    expect(CLARITY_PERSONA.enabled).toBe(true);
    // Follows the main model at run time; the stored pick is the
    // static main fallback (display seed, starting point for pinning).
    expect(CLARITY_PERSONA.followMain).toBe(true);
    expect(CLARITY_PERSONA.provider).toBe("claude");
    expect(CLARITY_PERSONA.model).toBe("claude-opus-5-5");
    expect(CLARITY_PERSONA.cardInstruction).toBe(
      "Rewrite this card's prose following your lens: the same facts, scope, hedges and citations, clearer to an engineer. If the card is already effective, return it unchanged.",
    );
    expect(CLARITY_PERSONA.color).toBe(PERSONA_COLORS[1]);
    expect(validatePersona(CLARITY_PERSONA)).toEqual([]);
  });

  it("lens preserves citations, containers and fences and keeps ambiguity", () => {
    expect(CLARITY_PERSONA.lens).toContain("[[diff:…]]");
    expect(CLARITY_PERSONA.lens).toContain("[[code:…]]");
    expect(CLARITY_PERSONA.lens).toContain("[[concept:…|…]]");
    expect(CLARITY_PERSONA.lens).toContain("`:::` container");
    expect(CLARITY_PERSONA.lens).toContain("d2 fences");
    expect(CLARITY_PERSONA.lens).toContain("preserve the ambiguity");
    expect(CLARITY_PERSONA.lens).not.toContain("ask one narrow question");
    expect(CLARITY_PERSONA.lens).not.toContain("Output only the rewritten text");
    expect(CLARITY_PERSONA.lens).not.toContain("ask for it");
  });
});

describe("built-in Guide (issue #379)", () => {
  it("is the fixed main agent: owns its model, no card instruction, style empty by default", () => {
    expect(GUIDE_PERSONA.id).toBe(GUIDE_PERSONA_ID);
    expect(GUIDE_PERSONA.id).toBe("guide");
    expect(GUIDE_PERSONA.name).toBe("Guide");
    expect(GUIDE_PERSONA.enabled).toBe(true);
    // It IS the main model: never follows, always explicit.
    expect(GUIDE_PERSONA.followMain).toBe(false);
    expect(GUIDE_PERSONA.provider).toBe("claude");
    expect(GUIDE_PERSONA.model).toBe("claude-opus-5-5");
    // No card instruction (its card task is the guide's own); the
    // writing-style lens is empty by default (no behaviour change).
    expect(GUIDE_PERSONA.cardInstruction).toBe("");
    expect(GUIDE_PERSONA.lens).toBe("");
    expect(validatePersona(GUIDE_PERSONA)).toEqual([]);
  });

  it("seeds first, leaving Second opinion and Clarity on their colours", () => {
    const seed = defaultPersonas();
    expect(seed.map((p) => p.id)).toEqual(["guide", "second-opinion", "clarity"]);
    expect(seed[0]).toMatchObject({ id: GUIDE_PERSONA_ID });
    expect(seed[1]).toMatchObject({ id: "second-opinion", color: PERSONA_COLORS[0] });
    expect(seed[2]).toMatchObject({ id: "clarity", color: PERSONA_COLORS[1] });
    expect(getGuidePersona(seed)).toMatchObject({ id: GUIDE_PERSONA_ID });
    expect(getGuidePersona([])).toBeUndefined();
  });

  it("allows an empty lens only for the Guide", () => {
    expect(validatePersona(valid({ lens: "" }))).toContain(
      "persona lens must be a non-empty string",
    );
    expect(validatePersona(valid({ lens: "  " }))).toContain(
      "persona lens must be a non-empty string",
    );
    expect(validatePersona({ ...valid({ lens: "" }), id: GUIDE_PERSONA_ID })).toEqual([]);
    expect(validatePersona({ ...valid({ lens: "  " }), id: GUIDE_PERSONA_ID })).toEqual([]);
  });
});
