/**
 * Update seam (issue #36, step 2 owns this file).
 *
 * Step 1 (branch `feat/preview-builds`, wired at merge) provides the real
 * implementation in `src/update/channels.ts` (`list release`/`release-rc`/
 * `preview/*` refs via `gh`), `src/update/install.ts` (global npm install
 * of `github:indigoviolet/unvibe#<ref>`) and `src/update/data-backup.ts`
 * (per-channel `unvibe.sqlite` backup/restore). This branch codes against
 * the seam only:
 *
 * ```ts
 * export interface Updater {
 *   listChannels(): Promise<UpdateChannel[]>;
 *   switchTo(ref: string): Promise<{ from: string; to: string }>;
 * }
 * ```
 *
 * - `FakeUpdater`: test-only backend (unit tests, the `UNVIBE_UPDATER_BACKEND=fake`
 *   service, the detached helper's live verification). Channel list comes
 *   from `<dataDir>/update/fake-channels.json` when present, else the
 *   constructor seed; the installed ref is tracked in
 *   `<dataDir>/update/current-ref`. Never touches the network, npm or git.
 * - `RealUpdaterPlaceholder`: what runs when no backend is wired (the
 *   default). Every method fails with a clear "not wired" error so the
 *   routes can answer 501 instead of hanging or half-switching.
 */
import fs from "node:fs";
import type { UpdateChannel } from "@unvibe/shared";
import { fakeChannelsPath, readCurrentRef, writeCurrentRef } from "./state.js";

export interface Updater {
  /** release, release-rc and every preview/* ref, with `current` set on the installed one. */
  listChannels(): Promise<UpdateChannel[]>;
  /** Back up / restore the DB per the channel rule, then install the ref globally. Call only with the service stopped. */
  switchTo(ref: string): Promise<{ from: string; to: string }>;
}

/**
 * What runs when step 1 is not wired yet (the default outside
 * `UNVIBE_UPDATER_BACKEND=fake`). Fails loudly so a switch can never
 * half-run: the routes translate this into 501.
 */
/** True for the placeholder's "step 1 not wired yet" failures (routes answer 501). */
export function isNotWiredError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("update backend not wired");
}

export function notWiredError(method: string): Error {
  return new Error(
    `update backend not wired: ${method} needs step 1 of issue #36 ` +
      `(preview publish + install + DB backup in src/update/); ` +
      `run with UNVIBE_UPDATER_BACKEND=fake for the test backend`,
  );
}

export class RealUpdaterPlaceholder implements Updater {
  listChannels(): Promise<UpdateChannel[]> {
    return Promise.reject(notWiredError("listChannels"));
  }

  switchTo(): Promise<{ from: string; to: string }> {
    return Promise.reject(notWiredError("switchTo"));
  }
}

export interface FakeChannelSpec {
  ref: string;
  kind?: UpdateChannel["kind"];
  version?: string | null;
  commit?: string | null;
  sourceBranch?: string | null;
  builtAt?: string | null;
}

function kindOf(ref: string): UpdateChannel["kind"] {
  if (ref === "release") return "release";
  if (ref === "release-rc") return "release-rc";
  return "preview";
}

/** Built-in fake channels (used when no `fake-channels.json` is present). */
export function defaultFakeChannels(): FakeChannelSpec[] {
  return [
    { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, builtAt: null },
    {
      ref: "release-rc",
      kind: "release-rc",
      version: "0.0.1-rc.1",
      commit: "abc1234def5678",
      sourceBranch: null,
      builtAt: new Date(Date.now() - 86400_000).toISOString(),
    },
    {
      ref: "preview/feat-x",
      kind: "preview",
      version: "0.0.1-preview.feat-x.abc1234",
      commit: "abc1234def5678",
      sourceBranch: "feat/x",
      builtAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  ];
}

/**
 * Test-only failure injection, read from `UNVIBE_UPDATE_FAKE_FAIL`:
 * - `install:<ref>` — `switchTo(ref)` throws (new build never installs).
 * - `health:<ref>` — `switchTo(ref)` reports success but does NOT advance
 *   the installed ref, so the restarted service still reports the old
 *   version and the helper times out waiting for the target (simulates a
 *   build that installs yet never comes up healthy). Rollback to any other
 *   ref behaves normally.
 */
export function fakeFailMode(env: NodeJS.ProcessEnv = process.env): { mode: "install" | "health"; ref: string } | null {
  const raw = env.UNVIBE_UPDATE_FAKE_FAIL;
  if (!raw) return null;
  const m = raw.match(/^(install|health):(.+)$/);
  if (!m) return null;
  return { mode: m[1] as "install" | "health", ref: m[2] };
}

/**
 * Fake channel specs: `<dataDir>/update/fake-channels.json` when present
 * (lets tests and the live-verification harness script the channel list),
 * else the constructor seed. Exported for `build-info.ts`, which must
 * resolve the same list without an Updater instance (health path).
 */
export function loadFakeSpecs(dataDir: string | null, seed: FakeChannelSpec[]): FakeChannelSpec[] {
  if (!dataDir) return seed;
  return readSeedFile(dataDir) ?? seed;
}

function readSeedFile(dataDir: string): FakeChannelSpec[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(fakeChannelsPath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as FakeChannelSpec[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c) => typeof c?.ref === "string");
  } catch {
    return null;
  }
}

export class FakeUpdater implements Updater {
  private readonly dataDir: string | null;
  private readonly seed: FakeChannelSpec[];

  constructor(dataDir?: string, seed?: FakeChannelSpec[]) {
    this.dataDir = dataDir ?? null;
    this.seed = seed ?? defaultFakeChannels();
  }

  private specs(): FakeChannelSpec[] {
    return loadFakeSpecs(this.dataDir, this.seed);
  }

  private current(): string {
    if (this.dataDir) return readCurrentRef(this.dataDir) ?? "release";
    return "release";
  }

  async listChannels(): Promise<UpdateChannel[]> {
    const current = this.current();
    return this.specs().map((c) => ({
      ref: c.ref,
      kind: c.kind ?? kindOf(c.ref),
      version: c.version ?? null,
      commit: c.commit ?? null,
      sourceBranch: c.sourceBranch ?? null,
      builtAt: c.builtAt ?? null,
      current: c.ref === current,
    }));
  }

  async switchTo(ref: string): Promise<{ from: string; to: string }> {
    const channels = await this.listChannels();
    if (!channels.some((c) => c.ref === ref)) {
      throw new Error(`unknown update channel "${ref}"`);
    }
    const from = channels.find((c) => c.current)?.ref ?? "release";
    if (from === ref) return { from, to: ref };
    const fail = fakeFailMode();
    if (fail && fail.ref === ref) {
      if (fail.mode === "install") {
        throw new Error(`fake install of "${ref}" failed (UNVIBE_UPDATE_FAKE_FAIL)`);
      }
      // "health": report success without advancing the installed ref.
      return { from, to: ref };
    }
    if (this.dataDir) writeCurrentRef(this.dataDir, ref);
    return { from, to: ref };
  }
}

/** Backend selection. Only `fake` is selectable; anything else (or unset) is the not-wired placeholder. */
export function createUpdaterFromEnv(dataDir: string, env: NodeJS.ProcessEnv = process.env): Updater {
  if (env.UNVIBE_UPDATER_BACKEND === "fake") return new FakeUpdater(dataDir);
  return new RealUpdaterPlaceholder();
}
