/*global console process setTimeout Buffer */
// Live spike harness (#208 forked reader), run as:
//   mise run build && node scripts/live-forked-reader.mjs \
//     --subject demo|public --provider claude|codex --mode baseline|forked [--port N]
//
// Boots the BUILT service on a temp data dir (real agents, small spend),
// opens one public PR review, and watches only until the reader stage is
// done: time to first card, per-card arrival, reader duration, the reader
// job's tokens/cache/turns (fork + repair turns included). Then kills the
// service it started; downstream stages (critic etc.) are abandoned, so
// their spend is not in the reader numbers. Results JSON lands in
// /tmp/spike208/results/ (card text stays there, never in the repo).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const SUBJECT = arg("subject", "demo");
const PROVIDER = arg("provider", "claude");
const MODE = arg("mode", "baseline");
const PORT = Number(arg("port", "4611"));
// Subjects are public PRs; numbers only (no titles) reach the write-up.
// demo = the bundled demo PR; public = a second small public PR.
const SUBJECTS = {
  demo: { repoUrl: "https://github.com/urllib3/urllib3.git", pr: 5020 },
  public: { repoUrl: "https://github.com/urllib3/urllib3.git", pr: 5260 },
};
const subj = SUBJECTS[SUBJECT];
if (!subj || !["claude", "codex"].includes(PROVIDER) || !["baseline", "forked"].includes(MODE)) {
  console.error("usage: --subject demo|public --provider claude|codex --mode baseline|forked");
  process.exit(2);
}
const MAIN = PROVIDER === "claude" ? { provider: "claude", model: "sonnet", effort: "" } : { provider: "codex", model: "gpt-5.6-terra", effort: "" };
// List-price estimates ($/1M tokens): input, output, cacheRead, cacheWrite.
const RATES = {
  claude: { in: 3, out: 15, cr: 0.3, cw: 3.75 },
  codex: { in: 1.25, out: 10, cr: 0.125, cw: 0 },
};
const cost = (u) => {
  const r = RATES[PROVIDER];
  return (u.inputTokens * r.in + u.outputTokens * r.out + u.cachedReadTokens * r.cr + u.cachedWriteTokens * r.cw) / 1e6;
};

const OUTDIR = "/tmp/spike208/results";
fs.mkdirSync(OUTDIR, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-208-data-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-208-"));
const REPO = path.join(WORK, "repo");
const env = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0", UNVIBE_ALLOW_LIVE_AGENT: "1" };
delete env.UNVIBE_AGENT;
delete env.GITHUB_TOKEN;
if (MODE === "forked") env.UNVIBE_FORKED_READER = "1";
else delete env.UNVIBE_FORKED_READER;

function api(method, p, body, token) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: p, method, headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(d); } catch { /* keep null */ }
          resolve({ code: res.statusCode, json, raw: d });
        });
      },
    );
    req.on("error", (e) => resolve({ code: 0, json: null, raw: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`cloning subject repo (shallow-ish)…`);
  const clone = spawnSync("git", ["clone", "--filter=blob:none", "--no-checkout", subj.repoUrl, REPO], { encoding: "utf8" });
  if (clone.status !== 0) throw new Error(`clone failed: ${clone.stderr.slice(-400)}`);
  const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const cleanup = async () => {
    child.kill("SIGTERM");
    await sleep(1500);
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  };
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(500);
      up = await new Promise((res) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (r) => { r.resume(); res(r.statusCode === 200); });
        req.on("error", () => res(false));
        req.on("timeout", () => req.destroy());
      });
    }
    if (!up) throw new Error(`service did not start: ${log.slice(-1500)}`);
    const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
    const settings = await api("PUT", "/api/settings", { main: MAIN, small: { provider: "claude", model: "haiku", effort: "" } }, token);
    if (settings.code !== 200) throw new Error(`settings ${settings.code}: ${settings.raw.slice(0, 300)}`);
    const added = await api("POST", "/api/repos", { path: REPO }, token);
    const repo = (added.json?.repos ?? []).find((r) => r.localPath === REPO) ?? (added.json?.repos ?? []).find((r) => r.id !== "demo");
    if (!repo) throw new Error(`repo add failed: ${added.code} ${added.raw.slice(0, 300)}`);
    const t0 = Date.now();
    const created = await api("POST", "/api/reviews", { repoId: repo.id, pr: subj.pr }, token);
    if (created.code !== 201 && created.code !== 202) throw new Error(`review create ${created.code}: ${created.raw.slice(0, 400)}`);
    const id = created.json.review.id;
    console.log(`${SUBJECT}/${PROVIDER}/${MODE}: review ${id}, watching reader…`);
    const cardAt = new Map();
    let firstCardAt = null;
    let snap = null;
    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      await sleep(1000);
      const got = await api("GET", `/api/reviews/${id}`, undefined, token);
      if (got.code !== 200) continue;
      snap = got.json;
      const root = (snap.pages ?? []).find((p) => p.id === "root");
      for (const c of root?.cards ?? []) {
        if (c.pending || !(c.blocks ?? []).length) continue;
        if (!cardAt.has(c.id)) {
          cardAt.set(c.id, { id: c.id, title: c.title, atSec: Math.round((Date.now() - t0) / 100) / 10 });
          if (firstCardAt === null) firstCardAt = cardAt.get(c.id).atSec;
        }
      }
      const stage = snap.pipeline?.stages?.reader;
      if (stage === "done" || stage === "error") break;
      if (Date.now() > deadline) throw new Error("reader did not finish in 10 min");
    }
    const readerDoneSec = Math.round((Date.now() - t0) / 100) / 10;
    const jobs = await api("GET", `/api/jobs?review=${id}`, undefined, token);
    const readerJobs = (jobs.json?.jobs ?? []).filter((j) => j.kind === "reader");
    const rj = readerJobs[0] ?? {};
    const usage = rj.usage ?? { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
    const root = (snap.pages ?? []).find((p) => p.id === "root");
    const cards = (root?.cards ?? []).filter((c) => !c.pending).map((c) => ({
      id: c.id,
      title: c.title,
      blocks: (c.blocks ?? []).length,
      chars: JSON.stringify(c.blocks ?? []).length,
      unverified: (c.blocks ?? []).flatMap((b) => [...(b.citations ?? []), ...((b.items ?? []).flatMap((i) => i.citations ?? []))]).filter((x) => x.unverified).length,
    }));
    const result = {
      subject: SUBJECT, provider: PROVIDER, mode: MODE, model: MAIN.model,
      files: (snap.files ?? []).length,
      hunks: (snap.files ?? []).reduce((n, f) => n + (f.hunks ?? []).length, 0),
      plotlines: (snap.plotlines ?? []).length,
      firstCardSec: firstCardAt, readerDoneSec,
      cardArrivals: [...cardAt.values()],
      cards,
      readerState: rj.state, readerError: rj.error ?? null,
      turns: (rj.turns ?? []).map((t) => ({ label: t.label, sec: t.finishedAt ? Math.round((t.finishedAt - t.startedAt) / 100) / 10 : null })),
      repairTurns: (rj.turns ?? []).filter((t) => /repair/.test(t.label)).length,
      forkTurns: (rj.turns ?? []).filter((t) => /^fork/.test(t.label) && !/repair/.test(t.label)).length,
      usage,
      cacheHitRate: usage.inputTokens + usage.cachedReadTokens > 0 ? Math.round((usage.cachedReadTokens / (usage.inputTokens + usage.cachedReadTokens)) * 1000) / 1000 : null,
      estCostUsd: Math.round(cost(usage) * 1000) / 1000,
      reviewUsageTotals: snap.usageTotals ?? null,
      guideText: (root?.cards ?? []).map((c) => ({ title: c.title, text: JSON.stringify(c.blocks) })),
    };
    const out = path.join(OUTDIR, `${SUBJECT}-${PROVIDER}-${MODE}.json`);
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, guideText: undefined }, null, 2));
    console.log(`wrote ${out}`);
  } finally {
    await cleanup();
    fs.writeFileSync(path.join(OUTDIR, `${SUBJECT}-${PROVIDER}-${MODE}.log`), log.slice(-4000));
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
await main();
