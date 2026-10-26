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
import { canonicalizeTarget, normalizeGlossary, parseId, parseReply, collectTargets, diagramHash, D2_MIN_VERSION } from "@unvibe/shared";
import { classifyFile, fileKeyForPath } from "../ingest/classify.js";
import { renderMarkdownBlocks } from "../ingest/description.js";
import { parseUnifiedDiff } from "../ingest/diff.js";
import { hashHunkLines } from "../ingest/hash.js";
import { uninterestingReason } from "../ingest/uninteresting.js";
import type { ManifestEntry } from "./runner.js";
import { createSnapshotLookup, validateReply, validateTarget } from "../validate/index.js";

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
        case "comment-link":
          return {
            ...b,
            diffRef: canonicalizeTarget(b.diffRef, resolveKey),
            citations: canonCites(b.citations),
          };
        case "aside":
          return { ...b, inner: canonBlocks(b.inner), citations: canonCites(b.citations) };
        case "diagram": {
          // D2 fixture diagrams: hash with the gated version (== the real
          // binary in dev/CI) and status ok. Pre-rendered light+dark SVGs
          // ship in fixtures/urllib3-5020/diagrams/<hash>.<theme>.svg; the
          // endpoint serves them (seeded cache) without needing `d2`.
          const hash = diagramHash(b.source, D2_MIN_VERSION);
          return { ...b, citations: canonCites(b.citations), render: { hash, status: "ok" as const } };
        }
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

  // Issue #252: the reader's glossary rides the snapshot (shared term list).
  const glossaryNormalized = normalizeGlossary(
    (reader.data?.glossary as { name?: string; definition?: string; citation?: string }[] | undefined) ?? [],
  );
  const glossary = glossaryNormalized.terms.map((t) => ({
    ...t,
    citation: canonicalizeTarget(t.citation, resolveKey),
  }));

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
      cards: rootCards,
    },
  ];

  for (const entry of manifest.recordings.filter((e) => e.kind === "critic")) {
    const parsed = parseReply(textOf(entry.file));
    // #215: one critic recording carries 1-3 findings (findings array).
    const findings = (parsed.data?.findings as { id?: string; title?: string; confidence?: string; summary?: string; cardIds?: string[] }[] | undefined) ?? null;
    if (findings) {
      let cursor = 0;
      for (const f of findings) {
        const pageId = f.id ?? entry.key ?? "f-critic";
        const cardIds = f.cardIds ?? [];
        const take = cardIds.length > 0 ? cardIds.length : 2;
        const slice = parsed.cards.slice(cursor, cursor + take);
        cursor += take;
        pages.push({
          id: pageId,
          kind: "finding",
          title: f.title ?? "Finding",
          parent: "root",
          ...(f.confidence ? { confidence: f.confidence } : {}),
          ...(f.summary ? { summary: f.summary } : {}),
          cards: slice.map((c, i) => mkCard(cardIds[i] ?? `${pageId}-${i}`, pageId, c.title, canonBlocks(c.blocks))),
        });
      }
      continue;
    }
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

  // #216: no concept pages are seeded; a concept page is written when
  // its link is opened (concept-page recordings stay for that on-demand fill).

  // --- annotations (prototype seed()) ----------------------------------
  // Annotation anchors use real file keys; card anchors use card#block IDs.
  // Issue #136: the seed conversation carries its turns (`Annotation.turns`)
  // so it renders like any explain result — each answer is a unit in its
  // own right (level, revision, undo stack). Content comes from the
  // recorded `explain-obs-fold` reply, canonicalized like the live
  // pipeline stores it.
  const connKey = meta.keyAliases["conn"];
  const tconnKey = meta.keyAliases["tconn"];
  const explainSeed = parseReply(textOf("explain-obs-fold.md"));
  const mkCommentReply = (who: "you" | "agent", text: string, suggested = false): import("@unvibe/shared").Reply => {
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return {
      id: `ans_${who}_${Math.random().toString(36).slice(2, 8)}`,
      kind: "comment",
      who,
      question: null,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: esc }, citations: [] }],
      level: "standard",
      revision: 1,
      undoStack: [],
      ...(suggested ? { suggested: true } : {}),
    };
  };
  const annotations: Annotation[] = [
    {
      id: "x-seed",
      type: "thread",
      anchor: {
        host: { kind: "block", blockId: "problem#b1" },
        quotedText: "raw CRLF",
        prefix: "value as it arrived, with the",
        suffix: "inside it, and urllib3 copied",
        position: 0,
        version: 1,
      },
      open: true,
      pinned: true,
      post: false,
      replies: [
        {
          id: "ans_seed1",
          kind: "explain",
          who: "agent",
          question: null,
          blocks: canonBlocks(explainSeed.blocks),
          level: "standard",
          revision: 1,
          undoStack: [],
        },
      ],
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
      pinned: false,
      replies: [mkCommentReply("you", "Does the fast path still catch a fold that uses a bare LF?")],
      post: false,
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
      pinned: false,
      replies: [mkCommentReply("agent", "Suggested comment.", true)],
      post: false,
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
      pinned: false,
      replies: [mkCommentReply("agent", "Suggested comment.", true)],
      post: false,
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
      pinned: false,
      replies: [mkCommentReply("you", "Is the double space here intended?")],
      post: false,
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
    ...(glossary.length > 0 ? { glossary } : {}),
    files,
    description: {
      html: rendered.html,
      rev: "1",
      source: "pr",
      editable: false,
    },
    ingest: { status: "ready" },
    pages,
    annotations,
    hunkStates,
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [
      { id: "job-reader", kind: "reader", model: "fixture", effort: "", priority: 1, state: "done" },
      { id: "job-critic", kind: "critic", model: "fixture", effort: "", priority: 2, state: "done" },
      { id: "job-hunk-pass", kind: "hunk-pass", model: "fixture", effort: "", priority: 3, state: "done" },
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

  // Issue #252: the reader's glossary citations validate like any other
  // citation (the stored snapshot carries the canonical targets above).
  if (glossaryNormalized.dropped.empty > 0 || glossaryNormalized.dropped.invalidCitation > 0) {
    failures.push({
      file: "reader.md",
      detail: `glossary dropped ${glossaryNormalized.dropped.empty} empty, ${glossaryNormalized.dropped.invalidCitation} invalid citations`,
    });
  }
  for (const term of glossary) {
    const parsed = parseId(term.citation);
    if (!parsed) {
      failures.push({ file: "reader.md", detail: `glossary citation does not parse: ${term.citation}` });
      continue;
    }
    const rep = validateTarget(term.citation, lookup);
    if (rep.status === "unverified") {
      failures.push({ file: "reader.md", detail: `glossary unverified ${term.citation}: ${rep.reason}` });
    } else if (rep.status === "repaired") {
      failures.push({ file: "reader.md", detail: `glossary needs repair ${term.citation} → ${rep.repairedTo}` });
    }
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
