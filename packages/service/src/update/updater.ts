/**
 * Update seam (issue #36).
 *
 * - `RealUpdater`: the production backend — `listChannels` is step 1's
 *   `gh`-based listing, `switchTo` is the shared switch core
 *   (`update/switch.ts`: backup, prefix-pinned install, landing
 *   verification; the live database stays in place). Call only with the
 *   service stopped (the detached helper owns that).
 * - `FakeUpdater`: test-only backend (unit tests, the
 *   `UNVIBE_UPDATER_BACKEND=fake` service, the detached helper's drills).
 *   Channel list comes from `<dataDir>/update/fake-channels.json` when
 *   present, else the constructor seed; the installed ref is tracked in
 *   `<dataDir>/update/current-ref`. Never touches the network, npm or git.
 */
import fs from "node:fs";
import type { UpdateChannel } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { RealCommandRunner } from "../exec/runner.js";
import { listChannels as listRealChannels, readInstalledBuild } from "./channels.js";
import { runSwitchCore } from "./switch.js";
import { fakeChannelsPath, readCurrentRef, writeCurrentRef } from "./state.js";

/** Test-only installed-build override (issue #231): partial build fields. */
export interface FakeInstalledOverride {
  version?: unknown;
  channel?: unknown;
  commit?: unknown;
  sourceBranch?: unknown;
  sourceCommit?: unknown;
  baseBranch?: unknown;
  baseCommit?: unknown;
  builtAt?: unknown;
}

export interface SwitchToOptions {
  /**
   * Rollback only: after the install verifies, restore this channel's
   * backup slot over the live files, so the old build never opens a
   * database the new build may have migrated.
   */
  restoreBackupOf?: string;
}

export interface Updater {
  /** release and every preview/* ref, with `current` set on the installed one. */
  listChannels(): Promise<UpdateChannel[]>;
  /** Back up the DB, then install the ref globally. Call only with the service stopped. */
  switchTo(ref: string, opts?: SwitchToOptions): Promise<{ from: string; to: string }>;
}

export interface RealUpdaterOptions {
  runner?: CommandRunner;
  dataDir: string;
  /**
   * Service entry path the install is verified against
   * (`process.argv[1]` of the switching service — never the helper copy's
   * own location).
   */
  serviceScriptPath: string | undefined;
  serviceVersion: string;
  /** Streams core lines; the helper passes its switch log. */
  log?: (line: string) => void;
  /**
   * Extra env for the npm spawns (issue #170): the login-shell-merged PATH.
   * The detached helper passes the service's repaired PATH here explicitly.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Production updater. `switchTo` throws with the core's lines joined on
 * failure (the helper records them in the outcome); the CLI keeps the
 * line-by-line form through `cli/update-flows.ts`.
 */
export class RealUpdater implements Updater {
  private readonly runner: CommandRunner;
  private readonly dataDir: string;
  private readonly serviceScriptPath: string | undefined;
  private readonly serviceVersion: string;
  private readonly log: (line: string) => void;
  private readonly env: Record<string, string | undefined> | undefined;

  constructor(opts: RealUpdaterOptions) {
    // Default stays the plain runner: this module is bundled into the
    // self-contained update helper (allowlist in
    // `update-helper-bundle.slow.test.ts`), so it must not pull in shim
    // resolution. Callers outside the helper (app.ts, CLI) pass the
    // shim-resolving runner explicitly (issue #109).
    this.runner = opts.runner ?? new RealCommandRunner();
    this.dataDir = opts.dataDir;
    this.serviceScriptPath = opts.serviceScriptPath;
    this.serviceVersion = opts.serviceVersion;
    this.log = opts.log ?? (() => {});
    this.env = opts.env;
  }

  async listChannels(): Promise<UpdateChannel[]> {
    const installed = readInstalledBuild(this.serviceScriptPath, this.serviceVersion);
    return listRealChannels(this.runner, installed);
  }

  async switchTo(ref: string, opts?: SwitchToOptions): Promise<{ from: string; to: string }> {
    const result = await runSwitchCore({
      runner: this.runner,
      dataDir: this.dataDir,
      serviceScriptPath: this.serviceScriptPath,
      serviceVersion: this.serviceVersion,
      channel: ref,
      ...(opts?.restoreBackupOf ? { restoreBackupOf: opts.restoreBackupOf } : {}),
      env: this.env,
      log: this.log,
    });
    if (result.code === 2) throw new Error(`unknown update channel "${ref}"`);
    if (result.code !== 0) {
      throw new Error(`switch to "${ref}" failed:\n${result.lines.join("\n")}`);
    }
    return { from: result.from.channel ?? "unknown", to: ref };
  }
}

export interface FakeChannelSpec {
  ref: string;
  kind?: UpdateChannel["kind"];
  version?: string | null;
  commit?: string | null;
  sourceBranch?: string | null;
  sourceCommit?: string | null;
  baseBranch?: string | null;
  baseCommit?: string | null;
  builtAt?: string | null;
}

function kindOf(ref: string): UpdateChannel["kind"] {
  return ref === "release" ? "release" : "preview";
}

/** Built-in fake channels (used when no `fake-channels.json` is present). */
export function defaultFakeChannels(): FakeChannelSpec[] {
  return [
    { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, builtAt: null },
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

export type FakeFailMode =
  | { mode: "install" | "health"; ref: string }
  | { mode: "list" };

/**
 * Test-only failure injection, read from `UNVIBE_UPDATE_FAKE_FAIL`:
 * - `install:<ref>` — `switchTo(ref)` throws (new build never installs).
 * - `health:<ref>` — `switchTo(ref)` reports success but does NOT advance
 *   the installed ref, so the restarted service still reports the old
 *   version and the helper times out waiting for the target (simulates a
 *   build that installs yet never comes up healthy). Rollback to any other
 *   ref behaves normally.
 * - `list` — `listChannels()` throws (issue #231: stages an update check
 *   that cannot run, so the top-bar icon must stay hidden with no error).
 */
export function fakeFailMode(env: NodeJS.ProcessEnv = process.env): FakeFailMode | null {
  const raw = env.UNVIBE_UPDATE_FAKE_FAIL;
  if (!raw) return null;
  if (raw === "list") return { mode: "list" };
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
    if (fakeFailMode()?.mode === "list") throw new Error("fake channel listing failed (UNVIBE_UPDATE_FAKE_FAIL=list)");
    const current = this.current();
    return this.specs().map((c) => ({
      ref: c.ref,
      kind: c.kind ?? kindOf(c.ref),
      version: c.version ?? null,
      commit: c.commit ?? null,
      sourceBranch: c.sourceBranch ?? null,
      sourceCommit: c.sourceCommit ?? null,
      baseBranch: c.baseBranch ?? null,
      baseCommit: c.baseCommit ?? null,
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
    if (fail && fail.mode !== "list" && fail.ref === ref) {
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

export interface UpdaterFromEnvOptions {
  runner?: CommandRunner;
  /** Service entry path (`process.argv[1]` of the service process). */
  serviceScriptPath?: string;
  serviceVersion?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Backend selection. `UNVIBE_UPDATER_BACKEND=fake` selects the test-only
 * fake; anything else (or unset) is the real backend.
 */
export function createUpdaterFromEnv(dataDir: string, opts: UpdaterFromEnvOptions = {}): Updater {
  const env = opts.env ?? process.env;
  if (env.UNVIBE_UPDATER_BACKEND === "fake") return new FakeUpdater(dataDir);
  return new RealUpdater({
    ...(opts.runner ? { runner: opts.runner } : {}),
    dataDir,
    serviceScriptPath: opts.serviceScriptPath ?? process.argv[1],
    // Last-resort fallback for readInstalledBuild (unreadable package);
    // then the channel is null and switching is refused, so the value
    // never surfaces. Callers pass the real SERVICE_VERSION.
    serviceVersion: opts.serviceVersion ?? "0.0.1",
  });
}
