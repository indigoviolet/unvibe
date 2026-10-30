/*global console process setTimeout clearTimeout setInterval clearInterval */
// Spike #320 harness: which session should a question fork from?
// Compares A (base pack), B (experienced session, cloned), C (base + deterministic
// explored layer), D (base + compacted note), CD (C+D) on the cached large demo
// (python/cpython#160318) with pi + meta/muse-spark-1.3-contributor.
//
//   node scripts/spike-320-harness.mjs [--cap 1] [--dry-run] [--only Q1,Q2]
//                                      [--sources A,B,C,D,CD] [--skip-grade]
//
// Live safety (brief): free pi --list-models + catalogue pricing first, a bounded
// pre-flight that refuses when the worst case exceeds --cap, spend tracked from
// the first token via scripts/live-pi-lib.mjs, and any pi 403
// client_attestation_denied stops the run immediately (no provider/model switch).
// --dry-run exercises prep, layer building, shuffling and reporting with a stub
// transport (no network, no spend). No product code is touched.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  copyCacheToScratch,
  demoLargeCacheDir,
  readDemoLargeMeta,
  repairWorktrees,
  rewriteManagedPaths,
} from "./demo-large-lib.mjs";
import {
  assertPriced,
  costOf,
  createSpendTracker,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  precheckModelOffered,
  resolvePiCmd,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPIKE_DIR = path.join(ROOT, "docs", "spikes", "320-fork-source");
const MODEL = { provider: "pi", model: "muse-spark-1.3-contributor" };
const LAYER_CAP_CHARS = 24000; // ~6k tokens, deterministic explored layer cap
const ANSWER_INSTRUCTION =
  "Answer the question about the change under review. Cite exact code with file paths and line numbers for every factual claim. " +
  "Use the read tool only when the context in front of you does not already contain what you need; do not re-read files or ranges already shown in your context. " +
  "Be specific and concise (at most ~350 words). Do not include follow-up suggestions.";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const CAP = Number(opt("--cap", "1"));
const DRY = argv.includes("--dry-run");
const ONLY = opt("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const SOURCES = opt("--sources", "A,B,C,D,CD").split(",").map((s) => s.trim()).filter(Boolean);
if (!Number.isFinite(CAP) || CAP <= 0) { console.error("--cap needs a positive USD value"); process.exit(2); }

// ---------- deterministic explored layer (source C) ----------
// Source of truth: the tool calls recorded on the cached build's jobs. The
// session with the most tool reads is the "experienced" session (in this cache
// the critic, with 32 calls; the reader used none). The layer lists each file
// and range once, in first-seen order, with a short excerpt read back from the
// worktree, plus one-line answered questions. Pure filesystem + DB: no model.
export function buildExploredLayer(dbPath, worktree) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let best = null;
  try {
    for (const row of db.prepare("SELECT kind, data FROM jobs").all()) {
      const data = JSON.parse(row.data);
      const reads = [];
      for (const turn of data.turnRecords ?? []) {
        for (const tool of turn.tools ?? []) {
          let detail = {};
          try { detail = JSON.parse(tool.detail ?? "{}"); } catch { /* keep empty */ }
          if (tool.name === "get_code" && detail.path && detail.lines) reads.push({ path: String(detail.path), lines: String(detail.lines), via: "get_code" });
          else if (tool.name === "read" && detail.path) reads.push({ path: String(detail.path), lines: detail.offset ? `${detail.offset}-${Number(detail.offset) + Number(detail.limit ?? 50) - 1}` : "1-50", via: "read" });
          else if (tool.name === "get_hunk" && detail.id) reads.push({ hunk: String(detail.id), via: "get_hunk" });
          else if (tool.name === "search_review" && detail.query) reads.push({ search: String(detail.query), via: "search_review" });
        }
      }
      if (!best || reads.length > best.reads.length) best = { kind: row.kind, reads };
    }
  } finally { db.close(); }
  const seen = new Set();
  const items = [];
  for (const r of best?.reads ?? []) {
    const keyOf = r.path ? `${r.path}:${r.lines}` : r.hunk ?? `search:${r.search}`;
    if (seen.has(keyOf)) continue;
    seen.add(keyOf);
    items.push(r);
  }
  const lines = [
    "## Already explored (deterministic layer, source C)",
    "",
    `The experienced session for this review (${best?.kind ?? "unknown"}; the session with the most tool reads) already opened the following. Do not re-read these ranges unless the question needs more than the excerpt shows.`,
    "",
  ];
  let used = lines.join("\n").length;
  let included = 0;
  for (const r of items) {
    let block;
    if (r.path) {
      let excerpt = "";
      try {
        const fileLines = fs.readFileSync(path.join(worktree, r.path), "utf8").split("\n");
        const [a, b] = r.lines.split("-").map(Number);
        excerpt = fileLines.slice((a || 1) - 1, Math.min(b || a || 1, (a || 1) + 11)).join("\n");
      } catch { excerpt = "(excerpt unavailable)"; }
      block = `- ${r.path} lines ${r.lines} (via ${r.via}):\n\`\`\`\n${excerpt}\n\`\`\``;
    } else if (r.hunk) {
      block = `- hunk ${r.hunk} (via get_hunk; full text is in the base pack or fetchable)`;
    } else {
      block = `- searched the review for ${JSON.stringify(r.search)} (via search_review)`;
    }
    if (used + block.length > LAYER_CAP_CHARS) { lines.push(`- (${items.length - included} more explored items omitted at the ${LAYER_CAP_CHARS}-char layer cap)`); break; }
    lines.push(block);
    used += block.length + 1;
    included += 1;
  }
  lines.push("", "Answered earlier in another thread: the critic found that SSLSocket.set_ech_config caches the config before the underlying call validates it, so a rejected call leaves a stale value that the next reconnect re-applies (see the finding page in the base pack).");
  return { text: lines.join("\n"), sessionKind: best?.kind ?? "unknown", totalReads: best?.reads.length ?? 0, uniqueItems: items.length, includedItems: included };
}

// ---------- pi RPC transport (live) + stub transport (dry-run) ----------
export class Pi403Error extends Error {}
function is403(text) { return /client_attestation_denied|403/.test(String(text)); }

export class PiSession {
  constructor(cwd, sessionDir) {
    this.child = spawn(
      resolvePiCmd()[0],
      ["--mode", "rpc", "--model", "meta/muse-spark-1.3-contributor", "--session-dir", sessionDir,
       "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-mcp",
       "--tools", "read,grep,find,ls"],
      { cwd, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" }, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.buf = "";
    this.waiters = [];
    this.events = [];
    this.stderr = "";
    this.child.stderr.on("data", (d) => { this.stderr += d.toString("utf8"); });
    this.child.stdout.on("data", (d) => {
      this.buf += d.toString("utf8");
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        this.events.push(ev);
        for (const w of [...this.waiters]) w(ev);
      }
    });
  }
  send(cmd) { this.child.stdin.write(`${JSON.stringify(cmd)}\n`); }
  async command(cmd, timeoutMs = 30000) {
    const id = `h-${Math.random().toString(36).slice(2, 10)}`;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`pi ${cmd.type} timed out`)), timeoutMs);
      const w = (ev) => {
        if (ev.type === "response" && ev.id === id) { clearTimeout(timer); this.waiters = this.waiters.filter((x) => x !== w); resolve(ev); }
      };
      this.waiters.push(w);
    });
    this.send({ ...cmd, id });
    const res = await done;
    if (!res.success) throw new Error(`pi ${cmd.type} failed: ${res.error ?? "unknown"}`);
    return res.data;
  }
  // Send one prompt; resolve at agent_settled with the turn's text, usage,
  // tool executions, TTFT and wall time. Usage sums assistant message_end
  // records seen after the prompt was sent.
  async prompt(message, timeoutMs = 600000) {
    const startIdx = this.events.length;
    const t0 = Date.now();
    let ttftMs = null;
    const settled = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pi prompt timed out")), timeoutMs);
      const w = (ev) => {
        if (ev.type === "agent_settled") { clearTimeout(timer); this.waiters = this.waiters.filter((x) => x !== w); resolve(); }
      };
      this.waiters.push(w);
    });
    const watcher = setInterval(() => {
      for (let i = startIdx; i < this.events.length; i++) {
        const ev = this.events[i];
        if (ttftMs === null && ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") ttftMs = Date.now() - t0;
        const blob = JSON.stringify(ev);
        if (is403(blob) && /error/i.test(ev.type ?? "")) { clearInterval(watcher); }
      }
    }, 100);
    this.send({ type: "prompt", message });
    await settled;
    clearInterval(watcher);
    const slice = this.events.slice(startIdx);
    const errors = slice.filter((e) => e.type === "message_end" && e.message?.errorMessage).map((e) => String(e.message.errorMessage));
    const allText = JSON.stringify(slice);
    if (errors.some(is403) || (is403(allText) && slice.some((e) => /error/i.test(e.type ?? "")))) {
      throw new Pi403Error(`pi 403 client_attestation_denied: ${errors.join("; ").slice(0, 300)}`);
    }
    if (errors.length) throw new Error(`pi turn error: ${errors.join("; ").slice(0, 300)}`);
    let text = "";
    const usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
    const tools = [];
    for (const ev of slice) {
      if (ev.type === "message_end" && ev.message?.role === "assistant") {
        for (const part of ev.message.content ?? []) if (part.type === "text") text += (text ? "\n" : "") + part.text;
        const u = ev.message.usage ?? {};
        usage.inputTokens += u.input ?? 0;
        usage.cachedReadTokens += u.cacheRead ?? 0;
        usage.cachedWriteTokens += u.cacheWrite ?? 0;
        usage.outputTokens += u.output ?? 0;
      }
      if (ev.type === "tool_execution_start") tools.push({ name: ev.toolName, args: ev.args });
    }
    return { text: text.trim(), usage, tools, ttftMs, totalMs: Date.now() - t0 };
  }
  async clone() { return this.command({ type: "clone" }); }
  close() { try { this.child.stdin.end(); } catch { /* gone */ } try { this.child.kill("SIGTERM"); } catch { /* gone */ } }
}

// Stub transport for --dry-run: same interface, canned usage/text, no network.
export class StubSession {
  async prompt(message) {
    const isQuestion = message.includes("Question:");
    return {
      text: isQuestion ? "Stub answer citing Lib/ssl.py lines 1479-1482 (dry run; no model was called)." : "ready",
      usage: { inputTokens: 100, cachedReadTokens: 50, cachedWriteTokens: 0, outputTokens: 20 },
      tools: [], ttftMs: 1, totalMs: 2,
    };
  }
  async clone() { return { cancelled: false }; }
  close() {}
}

// ---------- prep: scratch copy + real base pack from the browse service ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address(); s.close(() => resolve(a.port)); });
  });
}
function apiGet(port, apiPath, token) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: apiPath, method: "GET", headers: { authorization: `Bearer ${token}` } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ code: res.statusCode, body: d })); });
    req.on("error", (e) => resolve({ code: 0, body: String(e) }));
    req.end();
  });
}
async function prep() {
  const cache = demoLargeCacheDir();
  const meta = readDemoLargeMeta(cache);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike320-"));
  copyCacheToScratch(cache, data);
  const db = new DatabaseSync(path.join(data, "unvibe.db"));
  try { rewriteManagedPaths(db, data); } finally { db.close(); }
  repairWorktrees(data);
  const worktree = path.join(data, "worktrees", meta.reviewId);
  const cli = path.join(ROOT, "packages", "service", "dist", "index.js");
  if (!fs.existsSync(cli)) throw new Error(`missing build: ${cli} (run mise run build first)`);
  const port = await freePort();
  const child = spawn(process.execPath, [cli], {
    env: { ...process.env, UNVIBE_DATA_DIR: data, UNVIBE_PORT: String(port), UNVIBE_IDLE_MS: "0", UNVIBE_AGENT: "none" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errTail = "";
  child.stderr.on("data", (d) => { errTail = (errTail + d.toString("utf8")).slice(-2000); });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await new Promise((res) => {
        const q = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (r) => { r.resume(); res(r.statusCode === 200); });
        q.on("error", () => res(false));
      });
      if (child.exitCode !== null) break;
    }
    if (!up) throw new Error(`scratch service did not start: ${errTail}`);
    const token = fs.readFileSync(path.join(data, "token"), "utf8").trim();
    const sc = await apiGet(port, `/api/reviews/${meta.reviewId}/shared-context`, token);
    if (sc.code !== 200) throw new Error(`shared-context HTTP ${sc.code}`);
    const doc = JSON.parse(sc.body);
    const extract = (label) => {
      const at = doc.base.indexOf(label);
      if (at < 0) throw new Error(`shared-context missing ${label}`);
      const fence = doc.base.indexOf("````text", at);
      const start = doc.base.indexOf("\n", fence) + 1;
      const end = doc.base.indexOf("\n````", start);
      return doc.base.slice(start, end);
    };
    return { meta, data, worktree, system: extract("#### L0 system"), pack: extract("#### L1 + L1b + L2") };
  } finally {
    try { child.kill("SIGTERM"); } catch { /* gone */ }
  }
}

// ---------- main ----------
const estTokens = (chars) => Math.ceil(chars / 4);
async function main() {
  const questionsDoc = JSON.parse(fs.readFileSync(path.join(SPIKE_DIR, "questions.json"), "utf8"));
  const questions = questionsDoc.questions.filter((q) => ONLY.length === 0 || ONLY.includes(q.id));
  if (questions.length === 0) throw new Error("no questions selected");
  let rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let tracker = null;
  if (!DRY) {
    precheckModelOffered(resolvePiCmd(), MODEL);
    const catalog = await fetchPiCatalog(resolvePiCmd());
    const entry = findCatalogEntry(catalog, MODEL);
    rates = assertPriced(entry, { ...MODEL, allowUnpriced: false });
    tracker = createSpendTracker(rates, CAP);
  } else {
    rates = { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 };
    tracker = createSpendTracker(rates, CAP);
    console.log("dry run: stub transport, no network, no spend (catalogue rates assumed for accounting shape)");
  }
  const { meta, data, worktree, pack } = await prep();
  console.log(`prep: review ${meta.reviewId} worktree ${worktree} pack ~${estTokens(pack.length)} tokens`);
  const layer = buildExploredLayer(path.join(data, "unvibe.db"), worktree);
  fs.mkdirSync(path.join(SPIKE_DIR, "raw"), { recursive: true });
  fs.writeFileSync(path.join(SPIKE_DIR, "raw", "explored-layer.txt"), layer.text);
  console.log(`explored layer: session=${layer.sessionKind} reads=${layer.totalReads} unique=${layer.uniqueItems} included=${layer.includedItems} chars=${layer.text.length}`);
  // Bounded pre-flight: every context is capped, so the worst case is known.
  const maxCtxChars = pack.length + layer.text.length + 4000;
  const asksPlanned = questions.length * SOURCES.length;
  const worstAsk = costOf({ inputTokens: estTokens(maxCtxChars), outputTokens: 1200 }, rates);
  const worstTotal = worstAsk * (asksPlanned + 1) + worstAsk * questions.length;
  if (worstTotal > CAP) throw new Error(`live pre-flight: bounded worst case ${formatUsd(worstTotal)} exceeds cap ${formatUsd(CAP)}; refusing before any spend`);
  console.log(`live pre-flight: bounded worst case ${formatUsd(worstTotal)} (${asksPlanned} asks + note + ${questions.length} grades) within cap ${formatUsd(CAP)}`);
  const newSession = () => (DRY ? new StubSession() : new PiSession(worktree, fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike320-sess-"))));
  const charge = (usage, what) => { tracker.add(usage); const s = tracker.check(what); console.log(`  spend so far ${formatUsd(s)} / ${formatUsd(CAP)}`); return s; };
  // Source D note: one extra turn on the experienced context. Trigger rule
  // proposed in the write-up: regenerate when the guide finishes and then
  // after every 15 further tool reads in the review.
  let note = "";
  let noteUsage = null;
  if (SOURCES.some((s) => s === "D" || s === "CD")) {
    const s = newSession();
    try {
      await s.prompt(`Read the base context below and reply with exactly \`ready\` and nothing else.\n\n${pack}`);
      const made = await s.prompt(
        `Write a compact "what I've learned" note (at most 600 words) from the explored material below: files and ranges and why they matter, established facts with file:line citations, answered questions, and dead ends. The note will be appended to the base pack for future question sessions.\n\n${layer.text}`);
      note = made.text;
      noteUsage = made.usage;
      if (!DRY) charge(noteUsage, "compacted note");
    } finally { s.close(); }
    fs.writeFileSync(path.join(SPIKE_DIR, "raw", "compacted-note.txt"), note);
    console.log(`compacted note: ${note.length} chars (~${estTokens(note.length)} tokens)`);
  }
  const contexts = {
    A: pack,
    B: pack, // experience is added as live tool reads in the same session, then cloned
    C: `${pack}\n\n${layer.text}`,
    D: `${pack}\n\n## What I've learned (compacted note, source D)\n\n${note}`,
    CD: `${pack}\n\n${layer.text}\n\n## What I've learned (compacted note, source D)\n\n${note}`,
  };
  const results = [];
  let stopped403 = null;
  outer: for (const q of questions) {
    for (const source of SOURCES) {
      const s = newSession();
      try {
        const readyTurn = await s.prompt(`Read the base context below and reply with exactly \`ready\` and nothing else.\n\n${contexts[source]}`);
        let sunk = null;
        if (source === "B") {
          const explore = await s.prompt(
            "Before answering questions, explore the change the way the earlier review session did: use the read tool to open Modules/_ssl.c lines 5295-5510, Modules/_ssl.c lines 2174-2285, Modules/_ssl.c lines 977-1000, Lib/ssl.py lines 1473-1530 and Lib/test/test_ssl.py lines 1-100. Then reply with one line: explored.");
          sunk = explore.usage;
        }
        await s.clone();
        const asked = await s.prompt(`Question: ${q.question}\n\n${ANSWER_INSTRUCTION}`);
        if (!DRY) charge(asked.usage, `${q.id}/${source}`);
        const rec = {
          question: q.id, kind: q.kind, explored: q.explored, source,
          usage: asked.usage, contextUsage: readyTurn.usage, ...(sunk ? { sunkUsage: sunk } : {}),
          costUsd: costOf(asked.usage, rates), ttftMs: asked.ttftMs, totalMs: asked.totalMs,
          toolReads: asked.tools, answer: asked.text,
        };
        results.push(rec);
        fs.writeFileSync(path.join(SPIKE_DIR, "answers", `${q.id}-${source}.md`), `# ${q.id} (${q.kind}${q.explored ? ", explored" : ""}) — source ${source}\n\n${asked.text}\n`);
        console.log(`${q.id}/${source}: in=${asked.usage.inputTokens} cacheR=${asked.usage.cachedReadTokens} out=${asked.usage.outputTokens} tools=${asked.tools.length} ttft=${asked.ttftMs}ms total=${asked.totalMs}ms cost=${formatUsd(rec.costUsd)}`);
      } catch (e) {
        if (e instanceof Pi403Error) { stopped403 = e; console.error(`STOP: ${e.message}`); break outer; }
        console.error(`${q.id}/${source} FAILED: ${e instanceof Error ? e.message : String(e)}`);
        results.push({ question: q.id, kind: q.kind, explored: q.explored, source, error: e instanceof Error ? e.message : String(e) });
      } finally { s.close(); }
    }
  }
  const out = { model: MODEL, capUsd: CAP, dryRun: DRY, stopped403: stopped403 ? String(stopped403.message) : null, noteUsage, layer: { sessionKind: layer.sessionKind, totalReads: layer.totalReads, uniqueItems: layer.uniqueItems, includedItems: layer.includedItems, chars: layer.text.length }, totals: tracker.totals, spendUsd: tracker.usd(), results };
  fs.writeFileSync(path.join(SPIKE_DIR, "raw", "results.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`results: ${results.length} records, spend ${formatUsd(tracker.usd())} -> ${path.join(SPIKE_DIR, "raw", "results.json")}`);
  if (stopped403) process.exitCode = 3;
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    if (e instanceof Pi403Error) { console.error(`STOP: ${e.message}`); process.exit(3); }
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}




