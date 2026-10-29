/**
 * #311 routes: status carries the read-only Outbox count and the
 * recorded previous build; go-back commits a switch through the
 * update hooks (known previous) or answers the terminal command
 * (unknown previous). Scratch data dirs only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { migrate, openDatabase } from "../src/store/index.js";
import { FakeUpdater } from "../src/update/updater.js";
import { readPendingSwitch, writeSwitchOutcome } from "../src/update/state.js";
import { goBackCommand, pickPreviousBuild } from "../src/update/previous.js";

const TOKEN = "data-format-test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedOldDir(dir: string, withDraft: boolean): void {
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "unvibe.db"));
  migrate(db);
  if (withDraft) {
    db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?)").run(
      "rv_1",
      1,
      JSON.stringify({
        review: { id: "rv_1", repoId: "repo", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
        version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
        files: [{ fileKey: "fk1", path: "src/app.py", category: "source", hunks: [] }],
        ingest: { status: "ready" },
        pages: [{ id: "root", kind: "root", title: "Guide title", cards: [] }],
        annotations: [
          {
            type: "thread",
            id: "t1",
            anchor: { host: { kind: "diff-line", fileKey: "fk1", line: 2 }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
            open: true,
            pinned: false,
            post: true,
            replies: [
              {
                id: "r1",
                kind: "comment",
                who: "you",
                question: null,
                blocks: [{ type: "paragraph", id: "b1", text: { standard: "Unposted draft text" }, citations: [] }],
                level: "standard",
                revision: 1,
                undoStack: [],
              },
            ],
          },
        ],
        hunkStates: [],
        fileStates: [],
        viewPrefs: {},
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
      }),
      0,
    );
  }
  db.close();
}

describe("pickPreviousBuild + goBackCommand", () => {
  const outcome = {
    status: "ok" as const,
    from: "preview/old",
    to: "release",
    finishedAt: "2026-10-29T00:00:00.000Z",
    fromVersion: "0.0.1-old",
  };

  it("picks the recorded previous build when it installed the current one", () => {
    expect(pickPreviousBuild({ outcome, currentChannel: "release" })).toEqual({ ref: "preview/old", version: "0.0.1-old" });
    expect(pickPreviousBuild({ outcome, currentChannel: null })).toEqual({ ref: "preview/old", version: "0.0.1-old" });
  });

  it("unknown: no outcome, rolled back, same channel, or a different current build", () => {
    expect(pickPreviousBuild({ outcome: null, currentChannel: "release" })).toBeNull();
    expect(pickPreviousBuild({ outcome: { ...outcome, status: "rolled-back" }, currentChannel: "release" })).toBeNull();
    expect(pickPreviousBuild({ outcome: { ...outcome, from: "release" }, currentChannel: "release" })).toBeNull();
    expect(pickPreviousBuild({ outcome, currentChannel: "preview/other" })).toBeNull();
  });

  it("commands: recorded channel, era tag for unstamped/format-1, generic otherwise", () => {
    expect(goBackCommand({ ref: "preview/old", version: null }, { stored: null })).toBe("unvibe update preview/old");
    expect(goBackCommand(null, { stored: null })).toBe("npm install -g github:indigoviolet/unvibe#v0.0.12");
    expect(goBackCommand(null, { stored: 1 })).toBe("npm install -g github:indigoviolet/unvibe#v0.0.12");
    expect(goBackCommand(null, { stored: 7 })).toBe("unvibe update <channel>");
  });
});

describe("data-format routes", () => {
  const prevEnv = process.env.UNVIBE_UPDATER_BACKEND;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.UNVIBE_UPDATER_BACKEND;
    else process.env.UNVIBE_UPDATER_BACKEND = prevEnv;
  });

  async function harness(dir: string) {
    process.env.UNVIBE_UPDATER_BACKEND = "fake";
    let spawned = 0;
    let shutdowns = 0;
    const created = await createApp(TOKEN, {
      dataDir: dir,
      updater: new FakeUpdater(dir),
      updateHooks: {
        spawnHelper: async () => {
          spawned += 1;
          return 4242;
        },
        requestShutdown: () => {
          shutdowns += 1;
        },
        shutdownDelayMs: 0,
      },
      serviceVersion: "0.0.2",
    });
    return { ...created, spawned: () => spawned, shutdowns: () => shutdowns };
  }

  it("status counts drafts read-only and names the previous build; go-back commits the switch", async () => {
    const dir = tmp("unvibe-df-routes-");
    seedOldDir(dir, true);
    writeSwitchOutcome(dir, {
      status: "ok",
      from: "preview/old",
      to: "release",
      finishedAt: "2026-10-29T00:00:00.000Z",
      fromVersion: "0.0.1-old",
    });
    fs.mkdirSync(path.join(dir, "update"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "update", "fake-channels.json"),
      JSON.stringify([
        { ref: "release", version: "0.0.2-new" },
        { ref: "preview/old", version: "0.0.1-old" },
      ]),
    );
    const before = fs.readFileSync(path.join(dir, "unvibe.db"));
    const h = await harness(dir);
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/data-format", headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        state: "mismatch",
        stored: null,
        outboxCount: 1,
        previousRef: "preview/old",
        previousVersion: "0.0.1-old",
        goBackCommand: "unvibe update preview/old",
      });
      // Counting never opened the stored DB for writing.
      expect(fs.readFileSync(path.join(dir, "unvibe.db")).equals(before)).toBe(true);

      const back = await h.app.inject({ method: "POST", url: "/api/data-format/go-back", headers: auth });
      expect(back.statusCode).toBe(202);
      expect(back.json()).toEqual({ from: "release", to: "preview/old" });
      expect(readPendingSwitch(dir)).toMatchObject({ from: "release", to: "preview/old" });
      expect(h.spawned()).toBe(1);
      // The data was not moved aside.
      expect(fs.existsSync(path.join(dir, "unvibe.db"))).toBe(true);
      expect(fs.readdirSync(path.dirname(dir)).filter((e) => e.includes(".bak-"))).toEqual([]);
    } finally {
      await h.app.close();
    }
  });

  it("unknown previous: status carries the terminal command and go-back answers it (409)", async () => {
    const dir = tmp("unvibe-df-routes-unknown-");
    seedOldDir(dir, false);
    const h = await harness(dir);
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/data-format", headers: auth });
      expect(res.json()).toMatchObject({
        state: "mismatch",
        outboxCount: 0,
        previousRef: null,
        goBackCommand: "npm install -g github:indigoviolet/unvibe#v0.0.12",
      });
      const back = await h.app.inject({ method: "POST", url: "/api/data-format/go-back", headers: auth });
      expect(back.statusCode).toBe(409);
      expect((back.json() as { error: string }).error).toContain("npm install -g github:indigoviolet/unvibe#v0.0.12");
      expect(h.spawned()).toBe(0);
    } finally {
      await h.app.close();
    }
  });
});
