/**
 * Release-notes generator (#330): merges since the previous build,
 * data-reset flag, missing previous, and human-notes merge/fallback.
 * All git/gh goes through a fake runner — no real GitHub, no real git.
 */
import { describe, expect, it } from "vitest";
import {
  buildReleaseNotes,
  chooseSummary,
  cleanMergeSubject,
  generateReleaseNotes,
  mergeHumanNotes,
  parseHumanNotes,
  parseMergeLog,
  renderReleaseBody,
} from "../../../scripts/release-notes-gen-lib.mjs";
import { buildReleaseArgs } from "../../../scripts/preview-lib.mjs";

type Call = { cmd: string; args: string[] };
function fakeRunner(handlers: Record<string, { stdout: string; code?: number }>) {
  const calls: Call[] = [];
  const runner = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const key = `${cmd} ${args.join(" ")}`;
    for (const [pat, res] of Object.entries(handlers)) {
      if (key.includes(pat)) return { stdout: res.stdout, stderr: "", code: res.code ?? 0 };
    }
    return { stdout: "", stderr: "unhandled", code: 1 };
  };
  return { runner, calls };
}

const MERGES = [
  "aaa111\x1fMerge pull request #330 from feat/release-notes\x1f\x1e",
  "bbb222\x1fMerge pull request #311 from feat/data-format\x1fCloses #311\x1e",
].join("\n");

describe("parseMergeLog + one-liner rule", () => {
  it("parses merges and extracts issue numbers", () => {
    const merges = parseMergeLog(MERGES);
    expect(merges).toHaveLength(2);
    expect(merges[0].issues).toEqual([330]);
    expect(merges[1].issues).toEqual([311]);
  });

  it("prefers the issue title's first line, else the cleaned merge subject", () => {
    expect(chooseSummary({ title: "Big title\nsecond line", subject: "Merge pull request #1 from x" })).toBe("Big title");
    expect(chooseSummary({ title: "", subject: "Merge pull request #1 from feat/x" })).toBe("");
    expect(cleanMergeSubject("Merge branch 'feat/x'")).toBe("");
  });
});

describe("generateReleaseNotes", () => {
  it("lists merges since the newest reachable tag with gh titles (never reads the channel ref's notes)", async () => {
    const { runner, calls } = fakeRunner({
      "describe": { stdout: "v0.0.0\n" },
      "show v0.0.0:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
      "log v0.0.0..HEAD": { stdout: MERGES },
      "issue view 330": { stdout: JSON.stringify({ title: "Release notes in builds", url: "https://github.com/indigoviolet/unvibe/issues/330" }) },
      "issue view 311": { stdout: JSON.stringify({ title: "Data format gate", url: "https://github.com/indigoviolet/unvibe/issues/311" }) },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "preview/feat-x",
      version: "0.0.1-preview.feat-x.head999",
      generatedAt: "2026-10-31T00:00:00.000Z",
    })) as { previousVersion: string; items: { number: number; summary: string }[]; dataResetNeeded: boolean };
    expect(notes.previousVersion).toBe("0.0.0");
    expect(notes.items.map((i) => i.number)).toEqual([330, 311]);
    expect(notes.items[0].summary).toBe("Release notes in builds");
    expect(notes.dataResetNeeded).toBe(false);
    expect(calls.some((c) => c.cmd === "gh")).toBe(true);
    expect(calls.some((c) => c.args.join(" ").includes("release-notes.json"))).toBe(false);
  });

  it("flags a data reset when DATA_FORMAT changed since the previous tag", async () => {
    const { runner } = fakeRunner({
      "describe": { stdout: "v0.0.1\n" },
      "show v0.0.1:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "log v0.0.1..HEAD": { stdout: MERGES },
      "issue view": { stdout: JSON.stringify({ title: "T", url: "https://example.invalid/1" }), code: 0 },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 2;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "release",
      version: "0.0.2",
    })) as { dataResetNeeded: boolean; previousDataFormat: number; dataFormat: number };
    expect(notes.dataResetNeeded).toBe(true);
    expect(notes.previousDataFormat).toBe(1);
    expect(notes.dataFormat).toBe(2);
  });

  it("excludes the current version's tag when building that release itself", async () => {
    const { runner } = fakeRunner({
      "describe": { stdout: "v0.0.2\n" },
      "tag --list": { stdout: "v0.0.2\nv0.0.1\n" },
      "show v0.0.1:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "log v0.0.1..HEAD": { stdout: MERGES },
      "issue view": { stdout: JSON.stringify({ title: "T", url: "https://github.com/indigoviolet/unvibe/issues/330" }) },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "release",
      version: "0.0.2",
    })) as { previousVersion: string | null; previousCommit: string | null };
    expect(notes.previousVersion).toBe("0.0.1");
    expect(notes.previousCommit).toBe("v0.0.1");
  });

  it("uses the newest reachable v* tag on every channel (cumulative since the last release)", async () => {
    const { runner, calls } = fakeRunner({
      "describe": { stdout: "v0.0.1\n" },
      "show v0.0.1:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "log v0.0.1..HEAD": { stdout: MERGES },
      "issue view 330": { stdout: JSON.stringify({ title: "Release notes in builds", url: "https://github.com/indigoviolet/unvibe/issues/330" }) },
      "issue view 311": { stdout: JSON.stringify({ title: "Data format gate", url: "https://github.com/indigoviolet/unvibe/issues/311" }) },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "preview/new-thing",
      version: "0.0.1-preview.new-thing.head999",
    })) as { previousVersion: string | null; previousCommit: string | null; items: { number: number }[] };
    expect(notes.previousVersion).toBe("0.0.1");
    expect(notes.previousCommit).toBe("v0.0.1");
    expect(notes.items.map((i) => i.number)).toEqual([330, 311]);
    expect(calls.some((c) => c.args.join(" ").includes("v0.0.1..HEAD"))).toBe(true);
  });

  it("handles a missing previous build with no tag at all (null, full history)", async () => {
    const { runner } = fakeRunner({
      "log HEAD": { stdout: MERGES },
      "issue view 330": { stdout: JSON.stringify({ title: "Release notes in builds", url: "https://github.com/indigoviolet/unvibe/issues/330" }) },
      "issue view 311": { stdout: "", code: 1 },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "preview/new-thing",
      version: "0.0.1-preview.new-thing.head999",
    })) as { previousVersion: string | null; items: { number: number; summary: string }[]; dataResetNeeded: boolean };
    expect(notes.previousVersion).toBeNull();
    expect(notes.items.map((i) => i.number)).toEqual([330, 311]);
    // gh failed for 311: falls back to the cleaned merge subject (empty) -> issue label.
    expect(notes.dataResetNeeded).toBe(false);
  });

  it("falls back to the merge subject when gh has no title", async () => {
    const { runner } = fakeRunner({
      "log HEAD": { stdout: "ccc333\x1fMerge pull request #42 from feat/thing\x1f\x1e" },
      "issue view 42": { stdout: "", code: 1 },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "preview/thing",
      version: "0.0.1-preview.thing.head999",
    })) as { items: { title: string }[] };
    expect(notes.items[0].title).toBe("Issue #42");
  });
});

describe("human notes merge", () => {
  const items = [
    { number: 330, title: "Release notes", summary: "Release notes", url: "https://github.com/indigoviolet/unvibe/issues/330" },
    { number: 311, title: "Data format", summary: "Data format", url: "https://github.com/indigoviolet/unvibe/issues/311" },
  ];

  it("merges an entry and falls back without one", () => {
    const human = parseHumanNotes(
      JSON.stringify({ "330": { whatChanged: "Builds ship notes.", whatToTry: "Open Version.", caveats: "Gates pending." } }),
    );
    const merged = mergeHumanNotes(items, human);
    expect(merged[0]).toMatchObject({
      whatChanged: "Builds ship notes.",
      whatToTry: "Open Version.",
      caveats: "Gates pending.",
      summary: "Builds ship notes.",
    });
    expect(merged[1].whatChanged).toBeUndefined();
    expect(merged[1].summary).toBe("Data format");
  });

  it("accepts the array form and drops non-string fields", () => {
    const human = parseHumanNotes([{ number: 311, whatChanged: "Format gate.", whatToTry: 42 }]);
    expect(human[311]).toEqual({ whatChanged: "Format gate." });
    expect(parseHumanNotes("not json")).toEqual({});
  });

  it("threads human fields into the generated notes and the release body", async () => {
    const { runner } = fakeRunner({
      "log HEAD": { stdout: MERGES },
      "issue view": { stdout: JSON.stringify({ title: "T", url: "https://github.com/indigoviolet/unvibe/issues/330" }) },
      "show HEAD:packages/shared/src/data-format.ts": { stdout: "export const DATA_FORMAT = 1;" },
      "rev-parse HEAD": { stdout: "headsha999\n" },
    });
    const notes = (await generateReleaseNotes({
      runner: runner as never,
      channel: "preview/feat-x",
      version: "0.0.1-preview.feat-x.head999",
      humanNotes: parseHumanNotes({ "330": { whatChanged: "Ships notes.", whatToTry: "Try Version." } }),
    })) as { items: { number: number; whatToTry?: string }[] };
    expect(notes.items.find((i) => i.number === 330)?.whatToTry).toBe("Try Version.");
    const body = renderReleaseBody(buildReleaseNotes({
      channel: "release", version: "0.0.2", dataFormat: 2, previousDataFormat: 1,
      items: [{ number: 330, title: "T", summary: "Ships notes.", url: "https://github.com/indigoviolet/unvibe/issues/330", whatChanged: "Ships notes.", whatToTry: "Try Version.", caveats: "Careful." }],
    }) as never);
    expect(body).toContain("Data reset needed");
    expect(body).toContain("What to try: Try Version.");
    expect(body).toContain("Caveats: Careful.");
  });
});

describe("preview publish dry-run threading", () => {
  it("passes the notes file through to the release build", () => {
    expect(buildReleaseArgs({ version: "0.0.1-preview.x.abc", branch: "preview/x", notesFile: "/tmp/notes.json" })).toContain("/tmp/notes.json");
    expect(buildReleaseArgs({ version: "0.0.1", branch: "release" })).not.toContain("--notes-file");
  });
});
