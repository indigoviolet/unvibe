/**
 * `ReviewLookup` over the shared `ReviewSnapshot` type, plus fixture extras
 * the snapshot itself does not carry (description paragraphs, file lengths,
 * concept slugs, file-key aliases, verbatim host texts).
 */
import type { Block, ReviewSnapshot } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import type { ReviewLookup } from "./lookup.js";

export interface SnapshotLookupExtra {
  /** alias → fileKey (e.g. prototype `conn` when the scheme differs). */
  aliases?: Record<string, string>;
  /** New-side file lengths by fileKey or path (for `code:` ranges). */
  fileLengths?: Record<string, number>;
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
      return [block.mermaid, block.caption ?? ""].join("\n");
    case "finding-link":
      return block.pageId;
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
  const fileLengths = extra.fileLengths ?? {};
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
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        if (card.id === cardId) return card.blocks;
      }
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

  return {
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

    fileLineCount(keyOrPath) {
      if (fileLengths[keyOrPath] !== undefined) return fileLengths[keyOrPath];
      const key = resolveFileKey(keyOrPath);
      if (key !== null && fileLengths[key] !== undefined) return fileLengths[key];
      const byPath = filesByPath.get(keyOrPath);
      if (byPath && fileLengths[byPath.fileKey] !== undefined) return fileLengths[byPath.fileKey];
      return null;
    },

    descParagraph(id) {
      return descTexts[id] ?? null;
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
      if (parsed?.kind === "diff") {
        // Snapshots carry hunks, not full line text: callers that need
        // diff-line quotes provide them via `extra.hostTexts`.
        return null;
      }
      return null;
    },

    mapId(id) {
      return snapshot.version.idMapping[id] ?? null;
    },
  };
}
