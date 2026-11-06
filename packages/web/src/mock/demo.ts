/**
 * Static-demo answers (issue #334): the mock replays the SAME recordings
 * and matcher as the service replay runner, shared from `@unvibe/shared`
 * (`replay-match.ts`) — no canned answers on either side.
 *
 * Recording texts are baked in at build time from
 * `fixtures/urllib3-5020/` (manifest + recordings + the alias map). The
 * bundle stays small: plain Markdown, no service code.
 */
import {
  canonicalizeTarget,
  parseHunkReply,
  parseReply,
  resolveRecording,
  type Block,
  type ReplayManifestEntry,
  type Thread,
} from "@unvibe/shared";
import { DEMO_INSTALL_URL } from "../demo.js";
import { MOCK_FILES } from "./diff.js";
// `?raw` keeps fixture data out of TS's NodeNext import-attribute rules;
// the loader parses the text below (same trick as `mock/guide.ts`).
import manifestRaw from "../../../../fixtures/urllib3-5020/manifest.json?raw";
import metaRaw from "../../../../fixtures/urllib3-5020/meta.json?raw";

const recordingModules = import.meta.glob<string>(
  "../../../../fixtures/urllib3-5020/recordings/*.md",
  { query: "?raw", import: "default", eager: true },
);

const entries: ReplayManifestEntry[] = (
  JSON.parse(manifestRaw) as { recordings: ReplayManifestEntry[] }
).recordings;

const texts = new Map<string, string>();
for (const [filePath, text] of Object.entries(recordingModules)) {
  texts.set(filePath.split("/").pop() ?? filePath, text);
}

const aliases = (
  JSON.parse(metaRaw) as { keyAliases?: Record<string, string> }
).keyAliases ?? {};

const filesByKey = new Map(MOCK_FILES.map((f) => [f.fileKey, f]));
function resolveFileKey(key: string): string | null {
  if (filesByKey.has(key)) return key;
  const aliased = aliases[key];
  return aliased && filesByKey.has(aliased) ? aliased : null;
}

/** Rewrite alias-form citation targets (`diff:conn:…`) to canonical form. */
function canonicalizeBlocks(blocks: Block[]): Block[] {
  const fix = (b: Block): Block => {
    const out = { ...(b as unknown as Record<string, unknown>) } as Record<string, unknown> & Block;
    if (Array.isArray((b as { citations?: unknown }).citations)) {
      out.citations = (b as { citations: { target: string }[] }).citations.map((c) => ({
        ...c,
        target: canonicalizeTarget(c.target, resolveFileKey),
      }));
    }
    const inner = (b as { inner?: Block[] }).inner;
    if (Array.isArray(inner)) out.inner = inner.map(fix) as never;
    return out;
  };
  return blocks.map(fix) as Block[];
}

let fillSeq = 0;

/** Restamp parsed block ids so two fills of one recording never share ids. */
function restamp(blocks: Block[]): Block[] {
  const stamp = `demo${Date.now().toString(36)}${++fillSeq}`;
  const fix = (b: Block): Block => {
    const out = { ...(b as unknown as Record<string, unknown>) } as Record<string, unknown> & Block;
    out.id = `${stamp}-${b.id}`;
    const inner = (b as { inner?: Block[] }).inner;
    if (Array.isArray(inner)) out.inner = inner.map(fix) as never;
    return out;
  };
  return blocks.map(fix);
}

/** The honest reply when no recording matches (never a placeholder). */
export function demoInstallMessageBlocks(): Block[] {
  return [
    {
      type: "paragraph",
      id: `demo-install-${Date.now().toString(36)}`,
      text: {
        standard:
          `The demo only has recorded answers. <a href="${DEMO_INSTALL_URL}" target="_blank" rel="noreferrer">Install Unvibe</a> to ask your own.`,
      },
      citations: [],
    },
  ] as unknown as Block[];
}

export interface DemoAnswer {
  blocks: Block[];
  /** True when the blocks came from a recording (false: install message). */
  recorded: boolean;
}

/**
 * Answer an Explain/Ask turn from the recordings, through the shared
 * matcher. `kind` selects the marker the pipeline would send, so the
 * quoted selection (not the kind word) decides which recording answers.
 */
export function demoAnswer(kind: "explain" | "ask", text: string): DemoAnswer {
  const resolved = resolveRecording(entries, (f) => texts.has(f), `replay-kind: ${kind}\n${text}`);
  if (!resolved.file) return { blocks: demoInstallMessageBlocks(), recorded: false };
  // A kind-only marker falls back to the kind's first entry when no
  // pattern matches. The service replays that entry; the demo has no
  // recording for the question, so it answers honestly instead — serving
  // an unrelated recording as the answer would be a canned answer.
  const entry = entries.find((e) => e.file === resolved.file);
  if (!entry?.pattern || !new RegExp(entry.pattern, "i").test(text)) {
    return { blocks: demoInstallMessageBlocks(), recorded: false };
  }
  const raw = texts.get(resolved.file);
  if (!raw) return { blocks: demoInstallMessageBlocks(), recorded: false };
  return { blocks: restamp(canonicalizeBlocks(parseReply(raw).blocks)), recorded: true };
}

/** File-key prefix → replay hunk key, for the bundled fixture. */
const HUNK_PREFIX: Record<string, string> = {
  "src-urllib3-connection.py": "conn",
  "test-test_connection.py": "tconn",
  "test-with_dummyserver-test_socketlevel.py": "tsock",
  "changelog-1362.bugfix.rst": "log",
};

/** A hunk's one-line summary, parsed from its recording (never canned). */
export function demoHunkSummary(fileKey: string, index: number): string | null {
  const prefix = HUNK_PREFIX[fileKey];
  if (!prefix) return null;
  const prompt = `replay-kind: hunk\nreplay-key: ${prefix}:${index}`;
  const resolved = resolveRecording(entries, (f) => texts.has(f), prompt);
  if (!resolved.file) return null;
  const raw = texts.get(resolved.file);
  if (!raw) return null;
  return parseHunkReply(raw).summary ?? null;
}

/**
 * The fixture's real on-demand diagram block (issue #341: no page embeds
 * a diagram anymore, so the mock seeds this recorded block for the
 * ok-path render test). Same matcher and canonicalization as every
 * other mock fill — no canned source.
 */
export function demoRealDiagramBlock(): Block | null {
  const resolved = resolveRecording(
    entries,
    (f) => texts.has(f),
    "replay-kind: diagram\nreplay-key: central",
  );
  if (!resolved.file) return null;
  const raw = texts.get(resolved.file);
  if (!raw) return null;
  const dg = parseReply(raw).blocks.find((b) => b.type === "diagram");
  if (!dg) return null;
  const [fixed] = canonicalizeBlocks([dg]);
  return { ...fixed, id: "b-demo-diagram-central" };
}

/** Demo go-deeper/concept fill: the recording's blocks, or null. */
export function demoCardBlocks(
  kind: "go-deeper" | "concept-page",
  key: string,
  hint: string,
): Block[] | null {
  const resolved = resolveRecording(
    entries,
    (f) => texts.has(f),
    `replay-kind: ${kind}\nreplay-key: ${key}\n${hint}`,
  );
  if (!resolved.file) return null;
  const raw = texts.get(resolved.file);
  if (!raw) return null;
  return restamp(canonicalizeBlocks(parseReply(raw).blocks));
}

/** True when the thread holds user-authored comments (persisted in demo). */
export function isDemoPersistedThread(t: Thread): boolean {
  return (t.replies ?? []).some((r) => (r as { kind?: string }).kind === "comment");
}
