/**
 * Snapshot builder: runs every `fixtures/urllib3-5020/` recording through
 * the parser + validator and assembles a complete `ReviewSnapshot`
 * (files, pages, cards, annotations seeded as in the prototype's `seed()`,
 * hunk states). Every citation must validate — the build throws otherwise.
 *
 * Files and hunks come from the canonical ingest code
 * (`parseUnifiedDiff`, `hashHunkLines`, `classifyFile`,
 * `uninterestingReason`, `renderMarkdownBlocks`), so the fixture snapshot
 * is exactly what a real ingest of that diff + PR body would produce. The
 * recordings keep the prototype's short file keys (`conn`, `tconn`,
 * `tsock`, `log`; see `meta.json` `keyAliases` for the mapping) as
 * aliases, resolved through one mapping at build time; the snapshot itself
 * contains only real IDs.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Annotation,
  Block,
  Card,
  Hunk,
  Page,
  ReviewFile,
  ReviewSnapshot,
} from "@unvibe/shared";
import { canonicalizeTarget, parseId, parseReply, collectTargets } from "@unvibe/shared";
import { classifyFile, fileKeyForPath } from "../ingest/classify.js";
import { renderMarkdownBlocks } from "../ingest/description.js";
import { parseUnifiedDiff } from "../ingest/diff.js";
import { hashHunkLines } from "../ingest/hash.js";
import { uninterestingReason } from "../ingest/uninteresting.js";
import type { ManifestEntry } from "./runner.js";
import { createSnapshotLookup, validateReply } from "../validate/index.js";

export interface FixtureMeta {
  repo: string;
  pr: number;
  title: string;
  headSha: string;
  mergeBaseSha: string;
  baseRef: string;
  fileKeys: Record<string, string>;
  /** Prototype short key → canonical file key (alias mapping). */
  keyAliases: Record<string, string>;
  descParagraphs: string[];
  concepts: string[];
}

export interface BuildFailure {
  file: string;
  detail: string;
}

function mkCard(id: string, pageId: string, title: string | null, blocks: Block[]): Card {
  return {
    id,
    pageId,
    title,
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks,
    undoStack: [],
  };
}

export interface BuiltSnapshot {
  snapshot: ReviewSnapshot;
  /** Per-recording citation counts (for the build log). */
  counts: { file: string; citations: number; links: number }[];
}

/**
 * Build the urllib3#5020 snapshot from a fixtures dir. Throws an `Error`
 * listing every unverified citation / bad anchor / malformed trailer.
 */
export function buildSnapshot(fixturesDir: string): BuiltSnapshot {
  const read = (p: string): string => fs.readFileSync(path.join(fixturesDir, p), "utf8");
  const meta = JSON.parse(read("meta.json")) as FixtureMeta;
  const diffEntries = JSON.parse(read("diff.json")) as {
    key: string;
    path: string;
    gen: boolean;
    diff: string;
  }[];
  const manifest = JSON.parse(read("manifest.json")) as { recordings: ManifestEntry[] };

  // --- files: canonical ingest ------------------------------------------
  // diff.json holds one `git diff` section per file; concatenated they are
  // exactly the diff text a real ingest would parse.
  const diffText = diffEntries.map((e) => e.diff).join("\n");
  const files: ReviewFile[] = parseUnifiedDiff(diffText).map((f) => {
    const category = classifyFile(f.path);
    const hunks: Hunk[] = f.hunks.map((h) => ({
      contentHash: hashHunkLines(h.lines),
      header: h.header,
      ...(h.context !== undefined ? { context: h.context } : {}),
      newStart: h.newStart,
      newEnd: h.newEnd,
      oldStart: h.oldStart,
      oldEnd: h.oldEnd,
      added: h.added,
      removed: h.removed,
      lines: h.lines.map((l) => ({ ...l })),
      ...(h.noNewline ? { noNewline: true as const } : {}),
      ...(() => {
        const reason = uninterestingReason(h, { category });
        return reason !== undefined ? { hiddenReason: reason } : {};
      })(),
    }));
    return {
      fileKey: fileKeyForPath(f.path),
      path: f.path,
      category,
      hunks,
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      ...(f.isNew ? { isNew: true as const } : {}),
      ...(f.isDeleted ? { isDeleted: true as const } : {}),
      ...(f.isRename ? { isRename: true as const } : {}),
      ...(f.isBinary ? { isBinary: true as const } : {}),
    };
  });
  const hunksOf = (fileKey: string): Hunk[] => files.find((f) => f.fileKey === fileKey)!.hunks;

  // --- description: canonical ingest -------------------------------------
  const rendered = renderMarkdownBlocks(read("description.md"));
  const descTexts: Record<string, string> = Object.fromEntries(
    rendered.paragraphs.map((p) => [p.id, p.text]),
  );

  const textOf = (file: string): string => read(path.join("recordings", file));

  // --- canonical targets -----------------------------------------------
  // Stored citations use canonical file keys (like the live pipeline);
  // the alias-form recordings resolve through this one mapping.
  const keyAliases = (meta.keyAliases ?? {}) as Record<string, string>;
  const resolveKey = (key: string): string | null => {
    if (files.some((f) => f.fileKey === key)) return key;
    const aliased = keyAliases[key];
    return aliased && files.some((f) => f.fileKey === aliased) ? aliased : null;
  };
  const canonCites = (cites: { target: string }[]): { target: string }[] =>
    cites.map((c) => ({ target: canonicalizeTarget(c.target, resolveKey) }));
  const canonSpec = (spec: unknown): unknown => {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) return spec;
    const out = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
    for (const key of ["nodes", "edges", "panels", "messages"]) {
      const list = out[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        if (typeof o["cite"] === "string" && o["cite"]) {
          o["cite"] = canonicalizeTarget(o["cite"] as string, resolveKey);
        }
      }
    }
    return out;
  };
  const canonBlocks = (blocks: Block[]): Block[] =>
    blocks.map((b) => {
      switch (b.type) {
        case "paragraph":
          return { ...b, citations: canonCites(b.citations) };
        case "list":
          return {
            ...b,
            items: b.items.map((it) => ({ ...it, citations: canonCites(it.citations) })),
            citations: canonCites(b.citations),
          };
        case "diagram":
          return {
            ...b,
            spec: canonSpec((b as { spec: unknown }).spec) as typeof b.spec,
            citations: canonCites(b.citations),
          };
        case "comment-link":
          return {
            ...b,
            diffRef: canonicalizeTarget(b.diffRef, resolveKey),
            citations: canonCites(b.citations),
          };
        case "aside":
          return { ...b, inner: canonBlocks(b.inner), citations: canonCites(b.citations) };
        default:
          return { ...b, citations: canonCites((b as { citations: { target: string }[] }).citations) };
      }
    });

  // --- pages -----------------------------------------------------------
  const reader = parseReply(textOf("reader.md"));
  const readerCardIds = (reader.data?.cardIds as string[] | undefined) ?? [];
  const rootCards: Card[] = reader.cards.map((c, i) =>
    mkCard(readerCardIds[i] ?? `reader-${i}`, "root", c.title, canonBlocks(c.blocks)),
  );

  for (const key of ["flow", "design", "regex", "check"]) {
    const entry = manifest.recordings.find((e) => e.kind === "go-deeper" && e.key === key)!;
    const parsed = parseReply(textOf(entry.file));
    const cardId = (parsed.data?.cardId as string | undefined) ?? `g-${key}`;
    const title = (parsed.data?.title as string | undefined) ?? null;
    rootCards.push(mkCard(cardId, "root", title, canonBlocks(parsed.blocks)));
  }

  const pages: Page[] = [
    {
      id: "root",
      kind: "root",
      title: meta.title,
      saved: false,
      cards: rootCards,
    },
  ];

  for (const entry of manifest.recordings.filter((e) => e.kind === "critic")) {
    const parsed = parseReply(textOf(entry.file));
    const finding = (parsed.data?.finding ?? {}) as {
      confidence?: string;
      summary?: string;
    };
    const cardIds = (parsed.data?.cardIds as string[] | undefined) ?? [];
    const title = (parsed.data?.title as string | undefined) ?? entry.key ?? "Finding";
    pages.push({
      id: entry.key!,
      kind: "finding",
      title,
      saved: false,
      parent: "root",
      ...(finding.confidence ? { confidence: finding.confidence } : {}),
      ...(finding.summary ? { summary: finding.summary } : {}),
      cards: parsed.cards.map((c, i) =>
        mkCard(cardIds[i] ?? `${entry.key}-${i}`, entry.key!, c.title, canonBlocks(c.blocks)),
      ),
    });
  }

  // Finding → suggested-comment links (PRD §4.9): the seed threads below
  // exist with fixed ids, so the finding pages link them directly.
  const findingComment: Record<string, { thread: string; diff: string }> = {
    "f-lf": { thread: "t-sglf", diff: `diff:${keyAliases["conn"]}:82` },
    "f-perf": { thread: "t-sgperf", diff: `diff:${keyAliases["conn"]}:80` },
  };
  for (const page of pages) {
    if (page.kind !== "finding") continue;
    const link = findingComment[page.id];
    const last = link ? page.cards[page.cards.length - 1] : undefined;
    if (link && last) {
      last.blocks.push({
        type: "comment-link",
        id: "b-comment",
        diffRef: link.diff,
        threadId: link.thread,
        citations: [{ target: link.diff }],
      });
    }
  }

  const conceptTitles: Record<string, string> = {};
  for (const entry of manifest.recordings.filter((e) => e.kind === "concept-page")) {
    const parsed = parseReply(textOf(entry.file));
    const title = (parsed.data?.title as string | undefined) ?? entry.key!;
    conceptTitles[entry.key!] = title;
    pages.push({
      id: `c-${entry.key}`,
      kind: "concept",
      title,
      saved: true,
      parent: "root",
      cards: [mkCard(`cc-${entry.key}`, `c-${entry.key}`, null, canonBlocks(parsed.blocks))],
    });
  }

  // "Restated →" mapping (PRD §4.11): description paragraph → guide block
  // ids whose citations restate it, derived from the root page's `desc:`.
  const restated: Record<string, string[]> = {};
  const rootPage = pages.find((p) => p.id === "root")!;
  const scanTargets = (b: Block): string[] => {
    switch (b.type) {
      case "paragraph":
        return b.citations.map((c) => c.target);
      case "list":
        return [...b.citations.map((c) => c.target), ...b.items.flatMap((it) => it.citations.map((c) => c.target))];
      case "aside":
        return [...b.citations.map((c) => c.target), ...b.inner.flatMap(scanTargets)];
      case "table":
      case "code":
      case "diagram":
      case "finding-link":
      case "comment-link":
      case "follow-up":
        return b.citations.map((c) => c.target);
    }
  };
  for (const card of rootPage.cards) {
    for (const block of card.blocks) {
      for (const t of scanTargets(block)) {
        const parsed = parseId(t);
        if (parsed?.kind === "desc") {
          restated[parsed.paragraph] ??= [];
          if (!restated[parsed.paragraph].includes(block.id)) restated[parsed.paragraph].push(block.id);
        }
      }
    }
  }

  // --- annotations (prototype seed()) ----------------------------------
  // Annotation anchors use real file keys; card anchors use card#block IDs.
  // M4: the seed expansion carries its body (`Annotation.expansion`) so it
  // renders like any explain result — an expansion is a card in its own
  // right (level, read, collapsed, revision, undo stack). Content comes
  // from the recorded `explain-obs-fold` reply, canonicalized like the
  // live pipeline stores it.
  const connKey = meta.keyAliases["conn"];
  const tconnKey = meta.keyAliases["tconn"];
  const explainSeed = parseReply(textOf("explain-obs-fold.md"));
  const annotations: Annotation[] = [
    {
      id: "x-seed",
      type: "expansion",
      anchor: {
        host: { kind: "block", blockId: "problem#b1" },
        quotedText: "raw CRLF",
        prefix: "value as it arrived, with the",
        suffix: "inside it, and urllib3 copied",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [],
      post: false,
      note: false,
      expansion: {
        blocks: canonBlocks(explainSeed.blocks),
        level: "standard",
        read: false,
        collapsed: false,
        revision: 1,
        undoStack: [],
      },
    },
    {
      id: "t-seed",
      type: "thread",
      anchor: {
        host: { kind: "block", blockId: "central#b4" },
        quotedText: "fast path",
        prefix: "them.",
        suffix: ", which is almost all",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [
        { who: "you", text: "Does the fast path still catch a fold that uses a bare LF?" },
        {
          who: "ai",
          html: `Not with this PR. The fast path checks for <code>"\\r\\n"</code> and the pattern requires <code>\\r\\n</code>. <code>http.client</code> also accepts header lines that end in a bare LF. The tests only send CRLF folds. See the finding about bare LF folds.`,
        },
      ],
      post: false,
      note: false,
    },
    {
      id: "t-sglf",
      type: "thread",
      anchor: {
        host: { kind: "diff-line", fileKey: connKey, line: 82 },
        quotedText: "_OBSOLETE_FOLD_RE",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [
        {
          who: "ai",
          suggested: true,
          text: "http.client also accepts header lines that end in a bare LF, so a fold like `a=1\\n b=2` keeps its line break: both the `\"\\r\\n\" not in value` fast path and this pattern only look for CRLF. Would `\\r?\\n` here (and in the fast path), plus a test, make sense?",
        },
      ],
      post: false,
      note: false,
    },
    {
      id: "t-sgperf",
      type: "thread",
      anchor: {
        host: { kind: "diff-line", fileKey: connKey, line: 80 },
        quotedText: "Starting the optional OWS match",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [
        {
          who: "ai",
          suggested: true,
          text: "Could we add a test that normalizes a value with a very long run of spaces, so a later simplification of this pattern can't bring back the quadratic case?",
        },
      ],
      post: false,
      note: false,
    },
    {
      id: "t-diff",
      type: "thread",
      anchor: {
        host: { kind: "diff-line", fileKey: tconnKey, line: 220 },
        quotedText: "one  three",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [
        { who: "you", text: "Is the double space here intended?" },
        {
          who: "ai",
          html: `Yes. RFC 9112 allows replacing each fold with <em>one or more</em> spaces, and the helper replaces each fold with exactly one. <code>"one\\r\\n \\r\\n\\tthree"</code> contains two folds back to back, so it becomes two spaces. Collapsing them further would change whitespace the server actually sent.`,
        },
      ],
      post: false,
      note: false,
    },
  ];

  // --- hunk states ------------------------------------------------------
  const hunkStates = files.flatMap((f) =>
    f.hunks.map((h) => ({ contentHash: h.contentHash, folded: false, reviewed: false })),
  );
  const setState = (fileKey: string, index: number, patch: Record<string, unknown>): void => {
    const hash = hunksOf(fileKey)[index].contentHash;
    const s = hunkStates.find((x) => x.contentHash === hash)!;
    Object.assign(s, patch);
  };
  setState(meta.keyAliases["tconn"], 2, { reviewed: true, folded: true });
  setState(meta.keyAliases["conn"], 1, { note: "Only call site; everything else is the helper." });

  const version = {
    n: 1,
    headSha: meta.headSha,
    mergeBaseSha: meta.mergeBaseSha,
    baseRef: meta.baseRef,
    fetchedAt: 1760000000000,
    idMapping: {} as Record<string, string>,
  };
  const snapshot: ReviewSnapshot = {
    review: {
      id: "urllib3-5020",
      repoId: meta.repo,
      branch: meta.baseRef,
      prNumber: meta.pr,
      versions: [version],
      currentVersion: 1,
      createdAt: 1760000000000,
    },
    version,
    files,
    description: {
      html: rendered.html,
      rev: "1",
      source: "pr",
      editable: false,
      restated,
    },
    pages,
    annotations,
    hunkStates,
    jobs: [
      { id: "job-reader", kind: "reader", model: "fixture", priority: 1, state: "done" },
      { id: "job-critic-lf", kind: "critic", model: "fixture", priority: 2, state: "done" },
      { id: "job-critic-perf", kind: "critic", model: "fixture", priority: 2, state: "done" },
      { id: "job-hunk-pass", kind: "hunk-pass", model: "fixture", priority: 3, state: "done" },
    ],
    contributions: [],
    logTail: [],
    rev: 1,
  };

  // --- validate every recording -----------------------------------------
  const lookup = createSnapshotLookup(snapshot, {
    aliases: meta.keyAliases,
    descTexts,
    concepts: meta.concepts,
  });
  const failures: BuildFailure[] = [];
  const counts: { file: string; citations: number; links: number }[] = [];
  for (const entry of manifest.recordings) {
    const text = textOf(entry.file);
    const parsed = parseReply(text);
    if (parsed.splitError && parsed.splitError.kind !== "missing") {
      failures.push({ file: entry.file, detail: `trailing JSON ${parsed.splitError.kind}: ${parsed.splitError.message}` });
      continue;
    }
    if (parsed.splitError?.kind === "missing") {
      failures.push({ file: entry.file, detail: `missing trailing JSON block` });
      continue;
    }
    const anchor = parsed.data?.anchor as { quote?: string; host?: string } | undefined;
    const report = validateReply(parsed.blocks, lookup, {
      ...(anchor?.quote && anchor?.host ? { anchor: { quote: anchor.quote, host: anchor.host } } : {}),
    });
    const collected = collectTargets(parsed.blocks);
    counts.push({ file: entry.file, citations: collected.citations.length, links: collected.links.length });
    for (const t of report.tokens) {
      if (t.status === "unverified") {
        failures.push({ file: entry.file, detail: `unverified ${t.target}: ${t.reason}` });
      } else if (t.status === "repaired") {
        failures.push({ file: entry.file, detail: `needs repair ${t.target} → ${t.repairedTo}: ${t.reason}` });
      }
    }
    if (report.anchor && !report.anchor.ok) {
      failures.push({ file: entry.file, detail: `bad anchor on ${report.anchor.host}: ${report.anchor.reason}` });
    }
  }

  if (Object.keys(conceptTitles).length !== meta.concepts.length) {
    throw new Error(
      `snapshot build failed: concept pages cover [${Object.keys(conceptTitles).join(", ")}] but meta lists [${meta.concepts.join(", ")}]`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `snapshot build failed: ${failures.length} problem(s):\n` +
        failures.map((f) => `  ${f.file}: ${f.detail}`).join("\n"),
    );
  }
  return { snapshot, counts };
}

/** Default fixtures dir from a `dist/replay/` runtime location. */
export function defaultFixturesDir(distFileUrl: string): string {
  const here = path.dirname(new URL(distFileUrl).pathname);
  return path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020");
}
