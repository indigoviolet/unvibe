/*global console process setTimeout clearTimeout WebSocket fetch performance */
// SPIKE(#114) latency harness. Spends tokens: real claude/codex logins.
//
//   node spikes/latency/run.mjs --provider claude --port 4611 --label claude-1 \
//        [--pr 5020] [--repo-url https://github.com/urllib3/urllib3] [--plan full|open|actions]
//        [--main <model>] [--small <provider/model>] [--early-explain]
//
// Starts the BUILT service (packages/service/dist/index.js) on its own port
// with a fresh temp data dir and UNVIBE_SPIKE_TIMING set, opens one small
// PR, then drives the flows the way the web app does: an HTTP call per
// click, and a WebSocket that applies snapshot patches. "Visible" times are
// the arrival time of the patch that makes the thing true in the client's
// snapshot (render time is not included). Nothing is posted to GitHub: the
// only gh/git calls are the service's own read-only ingest.
//
// Output: spikes/latency/raw/<label>/{flows.json,timing.jsonl,service.log}
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);
const PROVIDER = arg("provider", "claude");
const PORT = Number(arg("port", "4611"));
const LABEL = arg("label", `${PROVIDER}-${Date.now()}`);
const PR = Number(arg("pr", "5020"));
const REPO_URL = arg("repo-url", "https://github.com/urllib3/urllib3");
const PLAN = arg("plan", "full");
const MAIN = arg("main", "");
const SMALL = arg("small", "");
const EARLY_EXPLAIN = flag("early-explain");
const OPENS = Number(arg("opens", "1"));
const REPLAY = flag("replay"); // no tokens: recorded sessions on the demo fixture (our own overhead only)

const OUT = path.join(ROOT, "spikes", "latency", "raw", LABEL);
fs.mkdirSync(OUT, { recursive: true });
const TIMING = path.join(OUT, "timing.jsonl");
fs.writeFileSync(TIMING, "");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-latency-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const load = () => os.loadavg().map((n) => Math.round(n * 100) / 100);
const mark = (name, data = {}) => fs.appendFileSync(TIMING, `${JSON.stringify({ t: now(), name, ...data })}\n`);

let token = "";
async function api(method, p, body) {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { code: res.status, json, raw: text, ms: Math.round(performance.now() - t0) };
}

// -- client-side snapshot (same patch rules as packages/web/src/state/store.ts)
function applyOp(root, op) {
  const parts = op.path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.length === 0) return op.value;
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node = Array.isArray(node) ? node[Number(parts[i])] : node[parts[i]];
    if (node === undefined || node === null) throw new Error(`bad path ${op.path}`);
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(node)) {
    const idx = last === "-" ? node.length : Number(last);
    if (op.op === "add") node.splice(idx, 0, op.value);
    else if (op.op === "remove") node.splice(idx, 1);
    else node[idx] = op.value;
  } else if (op.op === "remove") delete node[last];
  else node[last] = op.value;
  return root;
}

class Client {
  constructor(reviewId) {
    this.reviewId = reviewId;
    this.snapshot = null;
    this.jobs = new Map();
    this.waiters = [];
    this.pending = [];
    this.bytes = { patch: 0, job: 0, text: 0, other: 0 };
    this.counts = { patch: 0, job: 0, text: 0, other: 0 };
    this.firstTextAt = new Map(); // jobId -> t
    this.resyncs = 0;
  }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/events?review=${this.reviewId}&token=${token}`);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("ws error"));
    });
    this.ws.onmessage = (msg) => this.onEvent(String(msg.data));
    await this.resync();
  }
  async resync() {
    const got = await api("GET", `/api/reviews/${this.reviewId}`);
    if (got.code === 200) {
      this.snapshot = got.json;
      for (const j of got.json.jobs ?? []) this.jobs.set(j.id, j);
      this.drain();
      this.check();
    }
  }
  drain() {
    let progressed = true;
    while (progressed && this.snapshot) {
      progressed = false;
      this.pending = this.pending.filter((p) => p.headRev > this.snapshot.rev);
      const next = this.pending.find((p) => p.baseRev === this.snapshot.rev);
      if (next) {
        try {
          for (const op of next.ops) this.snapshot = applyOp(this.snapshot, op);
          this.snapshot.rev = next.headRev;
          progressed = true;
        } catch {
          this.pending = [];
          this.resyncs += 1;
          void this.resync();
          return;
        }
      }
    }
    if (this.pending.length > 0 && !this.resyncing) {
      // Gap: refetch once, like the web store's resync.
      this.resyncing = true;
      this.resyncs += 1;
      void this.resync().finally(() => {
        this.resyncing = false;
      });
    }
  }
  onEvent(raw) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const kind = ev.type === "patch" || ev.type === "job" || ev.type === "text" ? ev.type : "other";
    this.bytes[kind] += raw.length;
    this.counts[kind] += 1;
    if (ev.type === "patch") {
      this.pending.push(ev);
      this.drain();
    } else if (ev.type === "job") {
      this.jobs.set(ev.job.id, ev.job);
    } else if (ev.type === "text") {
      if (!this.firstTextAt.has(ev.jobId)) this.firstTextAt.set(ev.jobId, now());
    }
    this.check();
  }
  check() {
    if (!this.snapshot) return;
    for (const w of [...this.waiters]) {
      let ok = false;
      try {
        ok = w.pred(this.snapshot, this.jobs);
      } catch {
        ok = false;
      }
      if (ok) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(now());
      }
    }
  }
  /** Resolves with the epoch ms at which `pred` first held (null on timeout). */
  until(pred, timeoutMs = 15 * 60_000) {
    return new Promise((resolve) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(w);
      this.check();
    });
  }
  activeJobs() {
    return [...this.jobs.values()].filter((j) => ["queued", "running", "backing-off"].includes(j.state));
  }
  async idle(quietMs = 2500, timeoutMs = 15 * 60_000) {
    const deadline = now() + timeoutMs;
    let quietSince = null;
    while (now() < deadline) {
      if (this.activeJobs().length === 0) {
        quietSince ??= now();
        if (now() - quietSince >= quietMs) return true;
      } else quietSince = null;
      await sleep(200);
    }
    return false;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const rootOf = (s) => (s.pages ?? []).find((p) => p.id === "root");
const stage = (s, name) => s.pipeline?.stages?.[name];

/** A paragraph block with enough plain text to quote from; `skip` picks later ones. */
function pickQuote(snapshot, skip = 0) {
  const out = [];
  for (const card of rootOf(snapshot)?.cards ?? []) {
    for (const b of card.blocks ?? []) {
      if (b.type !== "paragraph") continue;
      const text = plain(b.text?.standard);
      const words = text.split(" ");
      if (words.length < 8) continue;
      // A phrase from the raw HTML-free text may not exist verbatim in the
      // stored HTML when it crosses a tag; take words from a tag-free run.
      const run = String(b.text.standard).split(/<[^>]*>/).map((x) => x.trim()).filter((x) => x.split(" ").length >= 4)[0];
      if (!run) continue;
      out.push({ cardId: card.id, blockId: b.id, quote: run.split(" ").slice(0, 6).join(" ") });
    }
  }
  return out[skip % Math.max(1, out.length)] ?? null;
}

const flows = [];
async function flow(name, fn) {
  const rec = { name, provider: PROVIDER, startedAt: now(), load: load(), marks: {} };
  mark("flow.start", { flow: name });
  console.log(`\n-- ${name} (load ${rec.load.join(" ")})`);
  try {
    await fn(rec);
  } catch (e) {
    rec.error = String(e?.message ?? e);
    console.log(`   ERROR ${rec.error}`);
  }
  rec.endedAt = now();
  mark("flow.end", { flow: name });
  const rel = Object.fromEntries(Object.entries(rec.marks).map(([k, v]) => [k, v === null ? null : Math.round(v - rec.startedAt)]));
  rec.rel = rel;
  console.log(`   ${JSON.stringify(rel)}`);
  flows.push(rec);
  fs.writeFileSync(path.join(OUT, "flows.json"), JSON.stringify({ label: LABEL, provider: PROVIDER, pr: PR, repo: REPO_URL, settings: runSettings, flows }, null, 2));
  return rec;
}

let runSettings = null;

async function openReview(repoId, n, early) {
  let client;
  let reviewId;
  await flow(`open#${n}`, async (rec) => {
    const created = await api("POST", "/api/reviews", REPLAY ? { repoId: "demo" } : { repoId, pr: PR });
    rec.marks.httpResponse = now();
    rec.http = { code: created.code, ms: created.ms };
    if (created.code !== 202 && created.code !== 201 && created.code !== 200) throw new Error(`create -> ${created.code} ${created.raw.slice(0, 200)}`);
    reviewId = created.json.review.id;
    rec.reviewId = reviewId;
    client = new Client(reviewId);
    await client.connect();
    rec.marks.wsConnected = now();
    const ingestReady = client.until((s) => !s.ingest || s.ingest.status === "ready");
    const firstCard = client.until((s) => (rootOf(s)?.cards ?? []).some((c) => (c.blocks ?? []).length > 0));
    const readerDone = client.until((s) => stage(s, "reader") === "done" || stage(s, "reader") === "error");
    const baseDone = client.until((s) => stage(s, "base") === "done");
    const firstFinding = client.until((s) => (s.pages ?? []).some((p) => p.kind === "finding"));
    const criticDone = client.until((s) => stage(s, "critic") === "done" || stage(s, "critic") === "error");
    const firstHunkSummary = client.until((s) => (s.hunkStates ?? []).some((h) => h.summary));
    const hunkDone = client.until((s) => stage(s, "hunk-pass") === "done" || stage(s, "hunk-pass") === "error");
    const conceptsDone = client.until((s) => stage(s, "concepts") === "done" || stage(s, "concepts") === "error");
    rec.marks.ingestReady = await ingestReady;
    const failed = client.snapshot?.ingest?.status === "failed";
    if (failed) throw new Error(`ingest failed: ${client.snapshot.ingest.error}`);
    rec.marks.firstCard = await firstCard;
    if (early) {
      // A reader who clicks as soon as there is text: Explain while the
      // reader and (soon) the background forks still run.
      rec.early = explainOnce(client, reviewId, "explain(early, during pipeline)", 0);
    }
    rec.marks.readerDone = await readerDone;
    rec.marks.baseDone = await baseDone;
    rec.marks.firstFinding = await firstFinding;
    rec.marks.criticDone = await criticDone;
    rec.marks.firstHunkSummary = await firstHunkSummary;
    rec.marks.hunkPassDone = await hunkDone;
    rec.marks.conceptsDone = await conceptsDone;
    await client.idle();
    rec.marks.allIdle = now() - 2500;
    const s = client.snapshot;
    rec.shape = {
      files: s.files.length,
      hunks: s.files.reduce((n2, f) => n2 + f.hunks.length, 0),
      rootCards: rootOf(s)?.cards.length,
      pending: rootOf(s)?.cards.filter((c) => c.pending).length,
      findings: s.pages.filter((p) => p.kind === "finding").length,
      concepts: s.pages.filter((p) => p.kind === "concept").length,
      snapshotBytes: JSON.stringify(s).length,
      stages: s.pipeline?.stages,
      usageTotals: s.usageTotals,
      ws: { bytes: { ...client.bytes }, counts: { ...client.counts }, resyncs: client.resyncs },
    };
    if (rec.early) await rec.early;
    delete rec.early;
  });
  return { client, reviewId };
}

async function action(client, reviewId, body) {
  const res = await api("POST", `/api/reviews/${reviewId}/actions`, body);
  if (res.code !== 200) throw new Error(`action ${body.kind} -> ${res.code} ${res.raw.slice(0, 300)}`);
  return res;
}

const jobTerminal = (jobs, id) => ["done", "error", "cancelled"].includes(jobs.get(id)?.state);

async function explainOnce(client, reviewId, name, skip) {
  return flow(name, async (rec) => {
    const q = pickQuote(client.snapshot, skip);
    if (!q) throw new Error("no quotable block");
    rec.target = q;
    const res = await action(client, reviewId, { kind: "explain", quote: q.quote, anchor: { where: "block", blockId: `${q.cardId}#${q.blockId}` } });
    rec.marks.httpResponse = now();
    rec.http = { ms: res.ms, jobId: res.json.jobId ?? null };
    const id = res.json.annotationId;
    rec.jobId = res.json.jobId;
    const ann = (s) => (s.annotations ?? []).find((a) => a.id === id);
    rec.marks.workingVisible = await client.until((s) => Boolean(ann(s)));
    const content = client.until((s) => (ann(s)?.expansion?.blocks ?? []).length > 0);
    const done = client.until((s) => ann(s) && !ann(s).working);
    rec.marks.firstContent = await content;
    rec.marks.done = await done;
    rec.error = ann(client.snapshot)?.error ?? undefined;
    if (rec.jobId) rec.marks.firstTextEvent = client.firstTextAt.get(rec.jobId) ?? null;
    await client.idle();
  });
}

async function runActions(client, reviewId) {
  await explainOnce(client, reviewId, "explain#1 (first on review)", 0);
  await explainOnce(client, reviewId, "explain#2", 1);
  await explainOnce(client, reviewId, "explain#3", 2);

  let threadId = null;
  await flow("ask (new thread on a card)", async (rec) => {
    const q = pickQuote(client.snapshot, 3);
    const res = await action(client, reviewId, {
      kind: "ask",
      quote: q.quote,
      anchor: { where: "block", blockId: `${q.cardId}#${q.blockId}` },
      message: "Why does this matter for a reviewer? Answer in two or three sentences.",
    });
    rec.marks.httpResponse = now();
    rec.http = { ms: res.ms };
    threadId = res.json.threadId;
    rec.jobId = res.json.jobId;
    const th = (s) => (s.annotations ?? []).find((a) => a.id === threadId);
    rec.marks.workingVisible = await client.until((s) => Boolean(th(s)));
    rec.marks.done = await client.until((s) => th(s) && !th(s).working && th(s).messages.some((m) => m.who === "ai"));
    rec.error = th(client.snapshot)?.error ?? undefined;
    if (rec.jobId) rec.marks.firstTextEvent = client.firstTextAt.get(rec.jobId) ?? null;
    await client.idle();
  });

  for (const n of [1, 2]) {
    await flow(`reply#${n} (existing thread)`, async (rec) => {
      if (!threadId) throw new Error("no thread");
      const th = (s) => (s.annotations ?? []).find((a) => a.id === threadId);
      const before = th(client.snapshot).messages.filter((m) => m.who === "ai").length;
      const res = await action(client, reviewId, {
        kind: "reply",
        threadId,
        message: n === 1 ? "What would break if this were left out? Two sentences." : "Is there a test that covers it? One sentence.",
      });
      rec.marks.httpResponse = now();
      rec.http = { ms: res.ms };
      rec.jobId = res.json.jobId;
      rec.marks.done = await client.until((s) => !th(s).working && th(s).messages.filter((m) => m.who === "ai").length > before);
      rec.error = th(client.snapshot)?.error ?? undefined;
      if (rec.jobId) rec.marks.firstTextEvent = client.firstTextAt.get(rec.jobId) ?? null;
      await client.idle();
    });
  }

  await flow("generate (Go deeper placeholder)", async (rec) => {
    const card = rootOf(client.snapshot)?.cards.find((c) => c.pending);
    if (!card) throw new Error("no placeholder card");
    rec.target = { cardId: card.id, label: card.pending.label };
    const res = await action(client, reviewId, { kind: "generate", cardId: card.id });
    rec.marks.httpResponse = now();
    rec.http = { ms: res.ms };
    rec.jobId = res.json.jobId;
    const c = (s) => rootOf(s)?.cards.find((x) => x.id === card.id);
    rec.marks.done = await client.until((s) => c(s) && !c(s).pending && c(s).blocks.length > 0);
    if (rec.jobId) rec.marks.firstTextEvent = client.firstTextAt.get(rec.jobId) ?? null;
    if (rec.jobId) await client.until((_s, jobs) => jobTerminal(jobs, rec.jobId), 120_000);
    await client.idle();
  });

  // The guide just changed (a card was filled): does the next action pay for a new base?
  await explainOnce(client, reviewId, "explain#4 (right after generate)", 4);
  await explainOnce(client, reviewId, "explain#5", 5);

  await flow("depth + (deeper) on the first card", async (rec) => {
    const card = rootOf(client.snapshot)?.cards.find((c) => !c.pending && c.blocks.length > 0);
    rec.target = { cardId: card.id };
    const res = await action(client, reviewId, { kind: "depth", cardId: card.id, direction: "deeper" });
    rec.marks.httpResponse = now();
    rec.http = { ms: res.ms };
    rec.jobId = res.json.jobId;
    const c = (s) => rootOf(s)?.cards.find((x) => x.id === card.id);
    rec.reused = res.json.reused ?? false;
    rec.marks.done = await client.until((s, jobs) => c(s).level !== card.level || (rec.jobId && jobTerminal(jobs, rec.jobId)), rec.jobId ? 5 * 60_000 : 5000);
    rec.levelAfter = c(client.snapshot).level;
    if (rec.jobId) rec.marks.firstTextEvent = client.firstTextAt.get(rec.jobId) ?? null;
    if (rec.jobId) await client.until((_s, jobs) => jobTerminal(jobs, rec.jobId), 120_000);
    await client.idle();
  });

  const hunks = client.snapshot.files.flatMap((f) => f.hunks.map((h) => h.contentHash));
  const summaryOf = (s, h) => (s.hunkStates ?? []).find((x) => x.contentHash === h)?.summary;
  for (const n of [1, 2]) {
    await flow(`hunk summary#${n} (one hunk)`, async (rec) => {
      const h = hunks[n - 1];
      await api("PATCH", `/api/reviews/${reviewId}/hunks/${h}`, { summary: null });
      await client.until((s) => !summaryOf(s, h), 10_000);
      rec.startedAt = now(); // the click is the summarize call, not the clear
      const res = await api("POST", `/api/reviews/${reviewId}/hunks/${h}/summarize`);
      rec.marks.httpResponse = now();
      rec.http = { ms: res.ms, code: res.code };
      rec.marks.done = await client.until((s) => Boolean(summaryOf(s, h)), 5 * 60_000);
      await client.idle();
    });
  }
  await flow(`fold all (${hunks.length} hunks)`, async (rec) => {
    for (const h of hunks) await api("PATCH", `/api/reviews/${reviewId}/hunks/${h}`, { summary: null });
    await client.until((s) => hunks.every((h) => !summaryOf(s, h)), 10_000);
    rec.startedAt = now();
    rec.hunks = hunks.length;
    const posts = await Promise.all(hunks.map((h) => api("POST", `/api/reviews/${reviewId}/hunks/${h}/summarize`)));
    rec.marks.httpResponse = now();
    rec.http = { maxMs: Math.max(...posts.map((p) => p.ms)), codes: posts.map((p) => p.code) };
    const first = client.until((s) => hunks.some((h) => summaryOf(s, h)), 5 * 60_000);
    const half = client.until((s) => hunks.filter((h) => summaryOf(s, h)).length >= Math.ceil(hunks.length / 2), 5 * 60_000);
    const all = client.until((s) => hunks.every((h) => summaryOf(s, h)), 10 * 60_000);
    rec.marks.firstSummary = await first;
    rec.marks.halfSummaries = await half;
    rec.marks.done = await all;
    await client.idle();
  });
}

const main = async () => {
  const env = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0", UNVIBE_SPIKE_TIMING: TIMING };
  delete env.UNVIBE_AGENT; // real agents
  if (REPLAY) env.UNVIBE_AGENT = "replay";
  delete env.GITHUB_TOKEN; // PRD §15: gh uses the keyring login
  // No Sentry/Axiom from a measurement run.
  for (const k of Object.keys(env)) if (k.startsWith("SENTRY_") || k.startsWith("AXIOM_")) delete env[k];
  const logFile = fs.openSync(path.join(OUT, "service.log"), "w");
  const tSpawn = now();
  const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", logFile, logFile] });
  console.log(`service pid ${child.pid} port ${PORT} data ${DATA}`);
  fs.writeFileSync(path.join(OUT, "service.pid"), String(child.pid));
  const stop = async () => {
    child.kill("SIGTERM"); // only the PID this script started
    await sleep(3000);
    try {
      child.kill("SIGKILL");
    } catch {
      // gone
    }
  };
  process.on("SIGINT", () => void stop().then(() => process.exit(130)));
  process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await sleep(250);
      try {
        up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status === 200;
      } catch {
        up = false;
      }
    }
    if (!up) throw new Error("service did not start");
    mark("harness.service-up", { ms: now() - tSpawn });
    token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();

    if (MAIN || PROVIDER !== "claude" || SMALL) {
      const body = {};
      if (MAIN || PROVIDER !== "claude") body.main = { provider: PROVIDER, model: MAIN };
      if (SMALL) body.small = { provider: SMALL.split("/")[0], model: SMALL.split("/")[1] };
      if (body.main && !body.main.model) {
        const models = await api("GET", `/api/models?provider=${PROVIDER}`);
        console.log(`models(${PROVIDER}): ${models.raw.slice(0, 600)}`);
        throw new Error("pass --main <model> for a non-default provider");
      }
      const put = await api("PUT", "/api/settings", body);
      if (put.code !== 200) throw new Error(`PUT settings -> ${put.code} ${put.raw.slice(0, 300)}`);
    }
    const tSet = performance.now();
    const settings = await api("GET", "/api/settings");
    runSettings = {
      main: settings.json?.main ?? settings.json?.settings?.main,
      small: settings.json?.small ?? settings.json?.settings?.small,
      secondOpinion: settings.json?.secondOpinion ?? settings.json?.settings?.secondOpinion,
      sessionsPerProvider: settings.json?.sessionsPerProvider ?? settings.json?.settings?.sessionsPerProvider,
      getSettingsMs: Math.round(performance.now() - tSet),
    };
    console.log(`settings ${JSON.stringify(runSettings)}`);

    // Clone is setup, not a measured flow (a user's repo is already there).
    const tClone = now();
    let repo = { id: "demo" };
    if (!REPLAY) {
      const added = await api("POST", "/api/repos", { url: REPO_URL });
      if (added.code >= 300) throw new Error(`repo add -> ${added.code} ${added.raw.slice(0, 300)}`);
      const repos = added.json?.repos ?? (await api("GET", "/api/repos")).json?.repos ?? [];
      repo = repos.find((r) => r.id !== "demo");
      if (!repo) throw new Error(`no repo after add: ${added.raw.slice(0, 300)}`);
      console.log(`repo ${repo.id} added in ${now() - tClone} ms`);
      mark("harness.repo-added", { ms: now() - tClone });
    }

    for (let n = 1; n <= OPENS; n++) {
      const { client, reviewId } = await openReview(repo.id, n, EARLY_EXPLAIN && n === 1);
      if (n === OPENS && PLAN !== "open" && client) await runActions(client, reviewId);
      const jobs = await api("GET", `/api/jobs?review=${reviewId}`);
      fs.writeFileSync(path.join(OUT, `jobs-${n}.json`), JSON.stringify(jobs.json, null, 2));
      client?.close();
      if (n < OPENS) {
        const del = await api("DELETE", `/api/reviews/${reviewId}`);
        console.log(`deleted review ${reviewId}: ${del.code}`);
        await sleep(2000);
      }
    }
  } finally {
    await stop();
    fs.closeSync(logFile);
    try {
      fs.rmSync(DATA, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  console.log(`\nwrote ${OUT}`);
};

await main();
