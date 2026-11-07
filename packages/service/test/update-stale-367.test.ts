/**
 * Issue #367 option A: a completed update pass clears `stale` (and the
 * hunk lists) on every card — not just the ones it revised, rechecked or
 * annotated. The pass also lists the stale cards it judged unaffected
 * (`unaffectedCards`, same single reply); a stale card in none of the
 * lists was missed — still cleared, and logged.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Card, ReviewSnapshot, UpdatePassResult } from "@unvibe/shared";
import { isUpdateAvailable } from "@unvibe/shared";
import { EventBus } from "../src/events.js";
import { RealCommandRunner } from "../src/exec/index.js";
import { ingestReview, writeReviewRows } from "../src/ingest/index.js";
import { ReviewStore } from "../src/state/store.js";
import { migrate, openDatabase } from "../src/store/index.js";
import { refreshReview } from "../src/versions/refresh.js";
import { applyUpdateResult, JsonBlockReplyParser } from "../src/versions/update.js";

function staleCard(id: string): Card {
  return {
    id,
    pageId: "root",
    title: `Card ${id}`,
    level: "standard",
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
    stale: true,
    staleChangedHunks: 2,
    staleHunks: ["h:k:aaa", "h:k:bbb"],
  } as unknown as Card;
}

function snapshotWithCards(ids: string[]): ReviewSnapshot {
  return {
    review: { id: "r367", repoId: "rp", branch: "feature", versions: [], currentVersion: 2, createdAt: 0 },
    version: { n: 2, headSha: "h2", mergeBaseSha: "mb", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", cards: ids.map(staleCard) }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
    versionStatus: {
      stale: true,
      fromVersion: 1,
      toVersion: 2,
      unchangedHunks: 0,
      changedHunks: 1,
      newHunks: 0,
      removedHunks: 0,
      renamedFiles: [],
      changedOldIds: [],
      changedNewIds: [],
      rangeDiff: "",
      fetchedAt: 0,
    },
  } as unknown as ReviewSnapshot;
}

function storeWith(snapshot: ReviewSnapshot): ReviewStore {
  const db = openDatabase(":memory:");
  migrate(db);
  const store = new ReviewStore(db, new EventBus());
  store.putSnapshot("r367", snapshot);
  return store;
}

function resultWith(over: Partial<UpdatePassResult>): UpdatePassResult {
  return {
    revisedCards: [],
    recheckedFindings: [],
    newFindings: [],
    hunkSummaries: {},
    ...over,
  };
}

describe("applyUpdateResult option A", () => {
  it("clears stale on every card when the pass touches only one; the shared predicate says up to date", async () => {
    const store = storeWith(snapshotWithCards(["card-a", "card-b"]));
    await applyUpdateResult(
      store,
      "r367",
      resultWith({
        addenda: [
          {
            cardId: "card-a",
            blocks: [
              {
                type: "paragraph",
                id: "b1",
                text: { standard: "Delta explained." },
                citations: [],
              },
            ],
          },
        ],
        unaffectedCards: ["card-b"],
      }),
    );
    const after = store.getSnapshot("r367");
    const cards = after?.pages.flatMap((p) => p.cards) ?? [];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.stale).toBe(false);
      expect(card.staleChangedHunks).toBeUndefined();
      expect(card.staleHunks).toBeUndefined();
    }
    expect(after?.versionStatus?.stale).toBe(false);
    expect(isUpdateAvailable(after?.versionStatus)).toBe(false);
  });

  it("clears and logs a stale card the pass missed entirely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = storeWith(snapshotWithCards(["card-a", "card-missed"]));
      await applyUpdateResult(
        store,
        "r367",
        resultWith({
          addenda: [
            {
              cardId: "card-a",
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "Delta explained." },
                  citations: [],
                },
              ],
            },
          ],
          unaffectedCards: ["card-a"],
        }),
      );
      const after = store.getSnapshot("r367");
      const cards = after?.pages.flatMap((p) => p.cards) ?? [];
      expect(cards.every((c) => c.stale === false)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("card-missed");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not log cards the pass confirmed unaffected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = storeWith(snapshotWithCards(["card-a"]));
      await applyUpdateResult(store, "r367", resultWith({ unaffectedCards: ["card-a"] }));
      expect(store.getSnapshot("r367")?.pages[0]?.cards[0]?.stale).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Refresh path (issue #367): after a refresh with new commits, the cards
 * that cite changed hunks are stale again — consistently with the shared
 * predicate. Real local git, no network, no agent.
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await new RealCommandRunner().run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");

describe("refresh re-stales cards citing changed hunks", () => {
  it("marks the citing card stale and the shared predicate available", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-367-"));
    const repoDir = path.join(tmp, "repo");
    const dataDir = path.join(tmp, "data");
    fs.mkdirSync(repoDir);
    fs.mkdirSync(dataDir);
    try {
      await git(repoDir, "init", "-b", "main");
      await git(repoDir, "config", "user.email", "t@example.com");
      await git(repoDir, "config", "user.name", "T");
      fs.writeFileSync(path.join(repoDir, "src-app.py"), V1);
      await git(repoDir, "add", ".");
      await git(repoDir, "commit", "-m", "base");
      await git(repoDir, "checkout", "-b", "feature");
      fs.writeFileSync(
        path.join(repoDir, "src-app.py"),
        V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22"),
      );
      await git(repoDir, "add", ".");
      await git(repoDir, "commit", "-m", "feature work");

      const runner = new RealCommandRunner();
      const ingested = await ingestReview({ runner, dataDir }, { repoPath: repoDir, branch: "feature" });
      const app = ingested.files.find((f) => f.path === "src-app.py");
      expect(app?.hunks).toHaveLength(2);
      const [hunk1, hunk2] = app!.hunks;
      const citing = (hash: string): Card =>
        ({
          id: `card-${hash.slice(0, 6)}`,
          pageId: "root",
          title: `Card ${hash.slice(0, 6)}`,
          level: "standard",
          collapsed: false,
          revision: 1,
          blocks: [
            {
              type: "paragraph",
              id: "b1",
              text: { standard: "Review note." },
              citations: [{ target: `h:${app!.fileKey}:${hash}` }],
            },
          ],
          undoStack: [],
        }) as unknown as Card;

      const db = openDatabase(":memory:");
      migrate(db);
      db.prepare("INSERT INTO repos (id, owner, name, local_path) VALUES (?, ?, ?, ?)").run(
        "rp367",
        "acme",
        "app",
        repoDir,
      );
      const reviewId = ingested.review.id;
      writeReviewRows(db, "rp367", ingested);
      const store = new ReviewStore(db, new EventBus());
      const fresh = {
        review: { ...ingested.review, repoId: "rp367" },
        version: ingested.version,
        files: ingested.files,
        description: ingested.description,
        commits: ingested.commits,
        ingest: { status: "ready" },
        pages: [{ id: "root", kind: "root", title: "Root", cards: [citing(hunk1!.contentHash), citing(hunk2!.contentHash)] }],
        annotations: [],
        hunkStates: [hunk1!, hunk2!].map((h) => ({ contentHash: h.contentHash, folded: false, reviewed: true })),
        fileStates: [],
        viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
      } as unknown as ReviewSnapshot;
      store.putSnapshot(reviewId, fresh);

      // v2 touches only the alpha hunk.
      fs.writeFileSync(
        path.join(repoDir, "src-app.py"),
        V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"),
      );
      await git(repoDir, "add", "src-app.py");
      await git(repoDir, "commit", "-m", "rework alpha");

      const snapBefore = store.getSnapshot(reviewId)!;
      const res = await refreshReview(
        { runner, db, reviews: store },
        repoDir,
        reviewId,
        { repoId: "rp367", branch: "feature", prNumber: null },
        snapBefore,
      );
      expect(res.moved).toBe(true);
      const after = store.getSnapshot(reviewId)!;
      expect(after.versionStatus?.stale).toBe(true);
      expect(after.versionStatus?.fromVersion).toBe(1);
      expect(after.versionStatus?.toVersion).toBe(2);
      expect(isUpdateAvailable(after.versionStatus)).toBe(true);
      const [card1, card2] = after.pages[0]!.cards;
      expect(card1!.stale).toBe(true);
      expect(card1!.staleChangedHunks).toBeGreaterThan(0);
      // The card citing only the untouched hunk stays fresh.
      expect(card2!.stale).not.toBe(true);
      db.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("JsonBlockReplyParser unaffectedCards", () => {
  it("parses the unaffected list; drops malformed entries", () => {
    const parser = new JsonBlockReplyParser();
    const reply = [
      "# Update pass",
      "Checked both stale cards.",
      "```json",
      JSON.stringify({ revisedCards: [], recheckedFindings: [], newFindings: [], hunkSummaries: {}, unaffectedCards: ["card-b"] }),
      "```",
    ].join("\n");
    expect(parser.parseReply(reply).unaffectedCards).toEqual(["card-b"]);
    const bad = reply.replace('["card-b"]', '["card-b", 42]');
    expect(parser.parseReply(bad).unaffectedCards).toBeUndefined();
  });
});
