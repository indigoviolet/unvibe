/**
 * Release notes shipped inside a build (#330): a channel's newest copy
 * fetched from its git ref over `gh api` — only when the caller asks
 * (Settings → Version Notes expand), never polled. The same file ships
 * in the build for the channel fetch and the GitHub Release body.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReleaseNotes, ReleaseNotesItem } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/gh.js";
import { UNVIBE_REPO } from "./channels.js";
import { fakeChannelsPath, updateDir } from "./state.js";

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Validate unknown JSON into `ReleaseNotes`; null on any bad shape (fail closed). */
export function parseReleaseNotes(raw: unknown): ReleaseNotes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.channel !== "string" || typeof d.version !== "string") return null;
  if (!Array.isArray(d.items)) return null;
  const items: ReleaseNotesItem[] = [];
  for (const e of d.items) {
    if (!e || typeof e !== "object") return null;
    const it = e as Record<string, unknown>;
    if (typeof it.number !== "number" || !Number.isInteger(it.number)) return null;
    if (typeof it.title !== "string" || typeof it.summary !== "string" || typeof it.url !== "string") return null;
    items.push({
      number: it.number,
      title: it.title,
      summary: it.summary,
      url: it.url,
      ...(optStr(it.whatChanged) ? { whatChanged: optStr(it.whatChanged) } : {}),
      ...(optStr(it.whatToTry) ? { whatToTry: optStr(it.whatToTry) } : {}),
      ...(optStr(it.caveats) ? { caveats: optStr(it.caveats) } : {}),
    });
  }
  return {
    channel: d.channel,
    version: d.version,
    previousVersion: strOrNull(d.previousVersion),
    commit: strOrNull(d.commit),
    previousCommit: strOrNull(d.previousCommit),
    dataFormat: typeof d.dataFormat === "number" && Number.isInteger(d.dataFormat) ? d.dataFormat : null,
    previousDataFormat:
      typeof d.previousDataFormat === "number" && Number.isInteger(d.previousDataFormat)
        ? d.previousDataFormat
        : null,
    dataResetNeeded: d.dataResetNeeded === true,
    generatedAt: typeof d.generatedAt === "string" ? d.generatedAt : "",
    items,
  };
}

/** Decode a `gh api .../contents/release-notes.json?ref=` response. */
export function decodeRefReleaseNotes(stdout: string): ReleaseNotes | null {
  try {
    const body = JSON.parse(stdout) as { content?: unknown };
    if (typeof body.content !== "string") return null;
    const text = Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
    return parseReleaseNotes(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Fetch one ref's shipped notes over `gh api` (no clone). Null on any failure. */
export async function fetchRefReleaseNotes(
  runner: CommandRunner,
  ref: string,
): Promise<ReleaseNotes | null> {
  const args = ["api", `repos/${UNVIBE_REPO}/contents/release-notes.json?ref=${ref}`];
  try {
    const res = await runGh(runner, args, { args });
    if (res.code !== 0) return null;
    return decodeRefReleaseNotes(res.stdout);
  } catch {
    return null;
  }
}

/** Test-only fake notes file: `<dataDir>/update/fake-release-notes.json` = `{ [ref]: ReleaseNotes }`. */
export function fakeReleaseNotesPath(dataDir: string): string {
  return path.join(updateDir(dataDir), "fake-release-notes.json");
}

export function readFakeReleaseNotes(dataDir: string, ref: string): ReleaseNotes | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fakeReleaseNotesPath(dataDir), "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return parseReleaseNotes(parsed[ref]);
  } catch {
    return null;
  }
}

export { fakeChannelsPath };
