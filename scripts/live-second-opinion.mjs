/*global console process fetch setTimeout clearTimeout */
/**
 * Live second-opinion check (M6, authorized, keep it small).
 *
 * With the built service and real agents (main = Claude, second opinion =
 * Codex), runs a blind second opinion on one finding of the demo fixture's
 * diff (seeded as a real review, no pipeline), and confirms it completes,
 * cites code, and that the stored prompt snapshot contains no guide text.
 *
 * Usage: `mise run test:live:second-opinion` (excluded from `check`).
 * Needs the `claude` and `codex` CLIs logged in (work logins) and
 * `mise run build` first. Token spend: one second-opinion turn on a small
 * context (~L1 + cited hunks).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SERVICE_ENTRY = path.join(root, "packages", "service", "dist", "index.js");
const FIXTURE_DIR = path.join(root, "fixtures", "urllib3-5020");
const REVIEW_ID = "live-so";

if (!fs.existsSync(SERVICE_ENTRY)) {
  console.error(`service not built: run \`mise run build\` first (missing ${SERVICE_ENTRY})`);
  process.exit(2);
}

async function api(origin, token, method, urlPath, body) {
  const res = await fetch(`${origin}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep raw text for error messages
  }
  return { status: res.status, json, text };
}

function seed(dataDir) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "snapshot.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8"));
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json);
  seeded.review.id = REVIEW_ID;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL,
        snapshot JSON NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER, current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );`,
    );
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run("seed-repo", "seed", "repo", "/tmp", Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run(REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
  } finally {
    db.close();
  }
}

function startService(dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVICE_ENTRY], {
      env: { ...process.env, UNVIBE_DATA_DIR: dataDir, UNVIBE_PORT: "0", UNVIBE_REPO_ROOTS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => reject(new Error(`service did not start: ${out}`)), 30000);
    proc.stdout?.on("data", (d) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({
          origin: m[1],
          token: m[2],
          stop: () =>
            new Promise((res) => {
              proc.on("exit", () => res());
              proc.kill("SIGTERM");
              setTimeout(() => {
                if (proc.exitCode === null) proc.kill("SIGKILL");
                res();
              }, 5000).unref?.();
            }),
        });
      }
    });
    proc.stderr?.on("data", (d) => process.stderr.write(d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code}: ${out}`));
      }
    });
  });
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-so-"));
seed(dataDir);
console.log(`seeded ${REVIEW_ID} in ${dataDir}`);
const svc = await startService(dataDir);
console.log(`service at ${svc.origin}`);
try {
  // Pick real models (main = Claude, second = Codex).
  const claude = await api(svc.origin, svc.token, "GET", "/api/models?provider=claude");
  const codex = await api(svc.origin, svc.token, "GET", "/api/models?provider=codex");
  if (claude.status !== 200) throw new Error(`claude models unavailable: ${claude.text}`);
  if (codex.status !== 200) throw new Error(`codex models unavailable: ${codex.text}`);
  const mainModel = claude.json.models[0];
  const secondModel = codex.json.models.includes("gpt-5.6-terra")
    ? "gpt-5.6-terra"
    : codex.json.models[0];
  console.log(`main=claude/${mainModel} second=codex/${secondModel}`);
  const set = await api(svc.origin, svc.token, "PUT", "/api/settings", {
    main: { provider: "claude", model: mainModel },
    secondOpinion: { provider: "codex", model: secondModel },
  });
  if (set.status !== 200) throw new Error(`settings update failed: ${set.text}`);

  const acted = await api(svc.origin, svc.token, "POST", `/api/reviews/${REVIEW_ID}/actions`, {
    kind: "second_opinion",
    cardId: "f-lf",
    mode: "blind",
  });
  if (acted.status !== 200) throw new Error(`second_opinion action failed: ${acted.text}`);
  const jobId = acted.json.jobId;
  console.log(`job ${jobId} started; waiting…`);
  let job = null;
  for (let i = 0; i < 60; i++) {
    const res = await api(svc.origin, svc.token, "GET", `/api/jobs?review=${REVIEW_ID}`);
    job = (res.json.jobs ?? []).find((j) => j.id === jobId) ?? null;
    if (job && (job.state === "done" || job.state === "error" || job.state === "cancelled")) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!job || job.state !== "done") {
    throw new Error(`second-opinion job did not complete: ${JSON.stringify(job)}`);
  }
  console.log(`job done: usage=${JSON.stringify(job.usage)} cacheHitRate=${job.cacheHitRate}`);

  const snapRes = await api(svc.origin, svc.token, "GET", `/api/reviews/${REVIEW_ID}`);
  const snap = snapRes.json;
  const opinions = snap.pages
    .find((p) => p.id === "f-lf")
    .cards.flatMap((c) => c.secondOpinions ?? []);
  if (opinions.length !== 1) throw new Error(`expected 1 second opinion, got ${opinions.length}`);
  const so = opinions[0];
  console.log(`verdict=${so.verdict} model=${so.provider}/${so.model} blocks=${so.blocks.length} missed=${!!so.missed}`);
  if (!["agrees", "partly", "disagrees"].includes(so.verdict)) throw new Error(`bad verdict ${so.verdict}`);
  if (so.blocks.length === 0) throw new Error("no reasoning blocks");
  const cites = JSON.stringify(so.blocks);
  if (!cites.includes("diff:")) throw new Error("reasoning cites no code");

  const promptRes = await api(svc.origin, svc.token, "GET", `/api/jobs/${jobId}/prompt`);
  const prompt = promptRes.json.promptSnapshot;
  if (prompt.includes("are not unfolded")) {
    throw new Error("prompt snapshot leaks the finding claim (blind isolation failed)");
  }
  if (prompt.includes("The central change")) {
    throw new Error("prompt snapshot leaks guide text (isolation failed)");
  }
  console.log("prompt snapshot has no guide text: OK");
  console.log("LIVE CHECK PASSED");
} finally {
  await svc.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
