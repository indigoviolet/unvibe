// DISABLED(#188): pins stage labels
import { describe, expect, it } from "vitest";
import { stageLabel, stagePhrase } from "./stageLabels.js";

describe("stageLabel", () => {
  it("maps each shared stage (entry 44)", () => {
    expect(stageLabel("reader")).toBe("Reading the change…");
    expect(stageLabel("base")).toBe("Preparing…");
    expect(stageLabel("critic")).toBe("Checking findings…");
    expect(stageLabel("concept")).toBe("Writing concept pages…");
    expect(stageLabel("concepts")).toBe("Writing concept pages…");
    expect(stageLabel("hunk-pass")).toBe("Summarizing code…");
    expect(stageLabel("go-deeper")).toBe("Writing deeper cards…");
  });
  it("omits anything else", () => {
    expect(stageLabel(undefined)).toBeUndefined();
    expect(stageLabel("")).toBeUndefined();
    expect(stageLabel("explain")).toBeUndefined();
    expect(stageLabel("update-pass")).toBeUndefined();
  });
});

describe("stagePhrase", () => {
  it("names the work for the failure sentence (entry 46)", () => {
    expect(stagePhrase("reader")).toBe("reading the change");
    expect(stagePhrase("base")).toBe("preparing");
    expect(stagePhrase("critic")).toBe("checking findings");
    expect(stagePhrase("concepts")).toBe("writing concept pages");
    expect(stagePhrase("hunk-pass")).toBe("summarizing code");
    expect(stagePhrase("anything-else")).toBe("building the guide");
    expect(stagePhrase(undefined)).toBe("building the guide");
  });
});
