/**
 * `ReviewLookup` over the shared `ReviewSnapshot` type, plus fixture extras
 * the snapshot itself does not carry (description paragraphs, file lengths,
 * concept slugs, file-key aliases, verbatim host texts).
 */
import type { Block, ReviewSnapshot } from "@unvibe/shared";
import { documentBlockText, parseId } from "@unvibe/shared";
import type { ReviewLookup } from "./lookup.js";

export interface SnapshotLookupExtra {
  /** alias → fileKey (e.g. prototype `conn` when the scheme differs). */
  aliases?: Record<string, string>;
  /** Paths known to exist at their cited commit (#81: existence only). */
  existingFiles?: ReadonlySet<string>;
  /** `path@sha` keys known to exist at that exact commit (#222). */
  existingCodeTargets?: ReadonlySet<string>;
  /** Description paragraph id → text. */
  descTexts?: Record<string, string>;
  /** Known concept slugs. */
  concepts?: string[];
  /** Verbatim host texts, keyed by host ID (`card:…#…`, `desc:…`, `diff:…`). */
  hostTexts?: Record<string, string>;
}

function blockText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return [block.text.standard, block.text.simple ?? "", block.text.deep ?? ""].join("\n");
    case "list":
      return block.items.map((i) => i.html).join("\n");
    case "table":
      return block.html;
    case "code":
      return block.code;
    case "diagram":
      return [block.source, block.caption ?? ""].join("\n");
    case "finding-link":
      return block.pageId;
    case "comment-link":
      return block.diffRef;
    case "follow-up":
      return block.items.map((i) => (i.ask ? `${i.label} ${i.ask}` : i.label)).join("\n");
    case "aside":
      return block.inner.map(blockText).join("\n");
  }
}

/** Build a lookup over a snapshot. Pure; no I/O. */
export function createSnapshotLookup(
  snapshot: ReviewSnapshot,
  extra: SnapshotLookupExtra = {},
): ReviewLookup {
  const aliases = extra.aliases ?? {};
  const existingFiles = extra.existingFiles ?? new Set<string>();
  const descTexts = extra.descTexts ?? {};
  const concepts = new Set(extra.concepts ?? []);
  const hostTexts = extra.hostTexts ?? {};

  const filesByKey = new Map(snapshot.files.map((f) => [f.fileKey, f]));
  const filesByPath = new Map(snapshot.files.map((f) => [f.path, f]));

  const resolveFileKey = (key: string): string | null => {
    if (filesByKey.has(key)) return key;
    const aliased = aliases[key];
    if (aliased && filesByKey.has(aliased)) return aliased;
    if (filesByPath.has(key)) return filesByPath.get(key)!.fileKey;
    return null;
  };

  const findCard = (cardId: string): Block[] | null => {
    // Issue #222: the document is a card holding its blocks.
    if (cardId === "document" && snapshot.document) {
      return snapshot.document.blocks.map((b) => b.block);
    }
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        if (card.id === cardId) return card.blocks;
      }
    }
    // Answers are cards in their own right (#136): `card:<ans>#<block>`
    // citations address their blocks the same way page cards do.
    for (const ann of snapshot.annotations) {
      const turn = (ann.turns ?? []).find((t) => t.id === cardId);
      if (turn) return turn.blocks;
    }
    return null;
  };

  const findBlock = (blocks: Block[], blockId: string): Block | null => {
    for (const b of blocks) {
      if (b.id === blockId) return b;
      if (b.type === "aside") {
        const inner = findBlock(b.inner, blockId);
        if (inner) return inner;
      }
    }
    return null;
  };

  const lookup: ReviewLookup = {
    resolveFileKey,

    hunkAtLine(fileKey, line) {
      const key = resolveFileKey(fileKey);
      if (key === null) return null;
      const file = filesByKey.get(key)!;
      for (const h of file.hunks) {
        if (line >= h.newStart && line <= h.newEnd) {
          return { hash: h.contentHash, start: h.newStart, end: h.newEnd };
        }
      }
      return null;
    },

    hunkRange(fileKey, hash) {
      const key = resolveFileKey(fileKey);
      if (key === null) return null;
      const h = filesByKey.get(key)!.hunks.find((x) => x.contentHash === hash);
      return h ? { start: h.newStart, end: h.newEnd } : null;
    },

    fileExists(filePath) {
      if (existingFiles.has(filePath)) return true;
      // A file in the diff exists at the head by construction.
      return filesByPath.has(filePath);
    },

    // `fileExistsAtCommit` is attached below only when the caller
    // resolved `path@sha` existence (#222); otherwise sha citations use
    // the path-only `fileExists` above (#81).

    descParagraph(id) {
      return descTexts[id] ?? null;
    },

    docBlock(id) {
      const found = (snapshot.document?.blocks ?? []).find((b) => b.id === id);
      return found ? documentBlockText(found) : null;
    },

    pageExists(id) {
      return snapshot.pages.some((p) => p.id === id);
    },

    cardExists(id) {
      return findCard(id) !== null;
    },

    blockExists(cardId, blockId) {
      const blocks = findCard(cardId);
      return blocks !== null && findBlock(blocks, blockId) !== null;
    },

    conceptKnown(slug) {
      return concepts.has(slug);
    },

    annotationExists(id) {
      return snapshot.annotations.some((a) => a.id === id);
    },

    hostText(host) {
      if (hostTexts[host] !== undefined) return hostTexts[host];
      const parsed = parseId(host);
      if (parsed?.kind === "card") {
        const blocks = findCard(parsed.cardId);
        if (!blocks) return null;
        if (!parsed.blockId) return blocks.map(blockText).join("\n");
        const b = findBlock(blocks, parsed.blockId);
        return b ? blockText(b) : null;
      }
      if (parsed?.kind === "desc") {
        return descTexts[parsed.paragraph] ?? null;
      }
      if (parsed?.kind === "doc") {
        const found = (snapshot.document?.blocks ?? []).find((b) => b.id === parsed.blockId);
        return found ? documentBlockText(found) : null;
      }
      if (parsed?.kind === "ann") {
        // Issue #214: an `ann:` host is a comment; its text is the host block.
        const ann = snapshot.annotations.find((a) => a.id === parsed.id && a.type === "comment");
        if (!ann) return null;
        return (ann.messages ?? []).map((m) => m.text ?? "").filter((t) => t !== "").join("\n\n");
      }
      if (parsed?.kind === "diff") {
        // New-side line text from the hunk rows, so quoted anchors on diff
        // lines check against the real cited content.
        const key = resolveFileKey(parsed.fileKey);
        if (key === null) return null;
        const out: string[] = [];
        for (const h of filesByKey.get(key)!.hunks) {
          for (const row of h.lines) {
            if (
              row.newLine !== undefined &&
              row.newLine >= parsed.start &&
              row.newLine <= parsed.end
            ) {
              out.push(row.text);
            }
          }
        }
        return out.length > 0 ? out.join("\n") : null;
      }
      return null;
    },

    mapId(id) {
      return snapshot.version.idMapping[id] ?? null;
    },
  };
  if (extra.existingCodeTargets) {
    const targets = extra.existingCodeTargets;
    lookup.fileExistsAtCommit = (filePath, sha) => targets.has(`${filePath}@${sha}`);
  }
  return lookup;
}
