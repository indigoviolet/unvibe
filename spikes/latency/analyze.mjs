/*global console process */
// SPIKE(#114): turn one harness run (raw/<label>/{flows.json,timing.jsonl})
// into stage breakdowns.
//
//   node spikes/latency/analyze.mjs <label> [--json]
//
// Prints, per flow, the click-to-visible timeline split into stages, and
// per job the ACP-level timeline (queue wait, session set-up, time to
// first token, generation, tools, our post-processing), with tokens.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const label = process.argv[2];
if (!label) {
  console.error("usage: analyze.mjs <label> [--json]");
  process.exit(2);
}
const asJson = process.argv.includes("--json");
const dir = path.join(ROOT, "raw", label);
const run = JSON.parse(fs.readFileSync(path.join(dir, "flows.json"), "utf8"));
const marks = fs
  .readFileSync(path.join(dir, "timing.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const s1 = (ms) => (ms === null || ms === undefined || Number.isNaN(ms) ? "–" : (ms / 1000).toFixed(1));

// -- jobs -------------------------------------------------------------------
const jobs = new Map();
for (const m of marks) {
  if (m.name === "job.enqueue") jobs.set(m.jobId, { id: m.jobId, kind: m.kind, provider: m.provider, model: m.model, priority: m.priority, enqueuedAt: m.t, starts: [], backoffs: [] });
  const j = jobs.get(m.jobId);
  if (!j) continue;
  if (m.name === "job.start") j.starts.push({ t: m.t, running: m.running });
  if (m.name === "job.backoff") j.backoffs.push({ t: m.t, delay: m.delay, error: m.error });
  if (m.name === "job.settle") Object.assign(j, { settledAt: m.t, state: m.state, sessionId: m.sessionId, usage: m.usage, error: m.error });
}

// -- turns per ACP session -----------------------------------------------------
const turns = new Map(); // sessionId -> [turn]
const reqs = new Map(); // sessionId -> [request]
const openTurn = new Map();
for (const m of marks) {
  if (m.name === "acp.request" && m.sessionId) {
    if (!reqs.has(m.sessionId)) reqs.set(m.sessionId, []);
    reqs.get(m.sessionId).push({ method: m.method, ms: m.ms, end: m.t, ok: m.ok });
  }
  if (m.name === "acp.turn.start") {
    const turn = { start: m.t, promptChars: m.promptChars, tools: [], provider: m.provider };
    openTurn.set(m.sessionId, turn);
    if (!turns.has(m.sessionId)) turns.set(m.sessionId, []);
    turns.get(m.sessionId).push(turn);
  }
  const t = openTurn.get(m.sessionId);
  if (!t) continue;
  if (m.name === "acp.turn.first-update") t.firstUpdateMs = m.ms;
  if (m.name === "acp.turn.first-text") t.firstTextMs = m.ms;
  if (m.name === "acp.turn.first-thought") t.firstThoughtMs = m.ms;
  if (m.name === "acp.turn.tool") t.tools.push({ ms: m.ms, kind: m.kind, title: m.title, status: m.status, id: m.toolCallId });
  if (m.name === "acp.turn.response") Object.assign(t, { responseMs: m.ms, textChars: m.textChars, textChunks: m.textChunks, thoughtChars: m.thoughtChars, lastTextMs: m.lastTextMs });
  if (m.name === "acp.turn.usage") Object.assign(t, { usage: { input: m.input, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite, output: m.output }, models: m.models, endMs: m.ms, model: m.model });
}

/** Tool wall time inside a turn: union of [first seen, completed/failed] per tool call id. */
function toolTime(turn) {
  const byId = new Map();
  for (const t of turn.tools) {
    if (!t.id) continue;
    const e = byId.get(t.id) ?? { start: t.ms, end: null, title: t.title };
    if (t.title && !e.title) e.title = t.title;
    if (t.status === "completed" || t.status === "failed") e.end = t.ms;
    byId.set(t.id, e);
  }
  const spans = [...byId.values()].filter((e) => e.end !== null).sort((a, b) => a.start - b.start);
  let total = 0;
  let cur = null;
  for (const sp of spans) {
    if (!cur || sp.start > cur.end) {
      if (cur) total += cur.end - cur.start;
      cur = { ...sp };
    } else cur.end = Math.max(cur.end, sp.end);
  }
  if (cur) total += cur.end - cur.start;
  return { calls: byId.size, ms: total, titles: [...byId.values()].map((e) => e.title ?? "?") };
}

function jobBreakdown(j) {
  const start = j.starts[0]?.t ?? null;
  const ts = (j.sessionId && turns.get(j.sessionId)) || [];
  const mine = ts.filter((t) => start !== null && t.start >= start && (!j.settledAt || t.start <= j.settledAt));
  const first = mine[0];
  const last = mine[mine.length - 1];
  const rq = ((j.sessionId && reqs.get(j.sessionId)) || []).filter((r) => r.method !== "session/prompt" && r.method !== "session/close");
  const out = {
    kind: j.kind,
    model: j.model,
    state: j.state,
    queueWait: start === null ? null : start - j.enqueuedAt,
    runningAtStart: j.starts[0]?.running,
    attempts: j.starts.length,
    backoffMs: j.backoffs.reduce((n, b) => n + b.delay, 0),
    setup: first && start !== null ? first.start - start : null,
    setupRequests: rq.map((r) => `${r.method.replace("session/", "")} ${r.ms}`).join(", "),
    turns: mine.length,
    ttft: first?.firstTextMs ?? null,
    firstThought: first?.firstThoughtMs ?? null,
    thoughtChars: mine.reduce((n, t) => n + (t.thoughtChars ?? 0), 0),
    textChunks: mine.reduce((n, t) => n + (t.textChunks ?? 0), 0),
    firstUpdate: first?.firstUpdateMs ?? null,
    turnMs: mine.reduce((n, t) => n + (t.responseMs ?? 0), 0),
    tools: mine.reduce((n, t) => n + toolTime(t).calls, 0),
    toolMs: mine.reduce((n, t) => n + toolTime(t).ms, 0),
    toolTitles: mine.flatMap((t) => toolTime(t).titles),
    grace: mine.reduce((n, t) => n + ((t.endMs ?? t.responseMs ?? 0) - (t.responseMs ?? 0)), 0),
    post: last && j.settledAt && last.endMs !== undefined ? j.settledAt - (last.start + last.endMs) : null,
    total: j.settledAt ? j.settledAt - j.enqueuedAt : null,
    usage: mine.reduce(
      (u, t) => ({
        input: u.input + (t.usage?.input ?? 0),
        cacheRead: u.cacheRead + (t.usage?.cacheRead ?? 0),
        cacheWrite: u.cacheWrite + (t.usage?.cacheWrite ?? 0),
        output: u.output + (t.usage?.output ?? 0),
      }),
      { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    ),
    textChars: mine.reduce((n, t) => n + (t.textChars ?? 0), 0),
    enqueuedAt: j.enqueuedAt,
    settledAt: j.settledAt,
    error: j.error,
  };
  return out;
}

// -- flows ----------------------------------------------------------------------
const result = { label, provider: run.provider, settings: run.settings, flows: [], baseBuilds: [], probes: [], totals: null };
for (const f of run.flows) {
  const inWin = (m) => m.t >= f.startedAt - 50 && m.t <= (f.endedAt ?? Infinity);
  const win = marks.filter(inWin);
  const flowJobs = [...jobs.values()].filter((j) => j.enqueuedAt >= f.startedAt - 50 && j.enqueuedAt <= (f.endedAt ?? Infinity));
  const row = {
    name: f.name,
    load: f.load,
    rel: f.rel,
    http: f.http,
    error: f.error,
    shape: f.shape,
    jobs: flowJobs.map(jobBreakdown),
    cmds: win.filter((m) => m.name === "cmd").map((m) => ({ cmd: `${path.basename(m.cmd)} ${m.args}`.slice(0, 90), ms: m.ms, at: m.t - f.startedAt })),
    baseBuilds: win.filter((m) => m.name === "sessions.base-build").map((m) => ({ ms: m.ms, packChars: m.packChars, endAt: m.t - f.startedAt, key: m.key.split("|")[2] })),
    preEnqueueBase: win.filter((m) => m.name === "pipe.fork.pre-enqueue-base").map((m) => ({ ms: m.ms, kind: m.kind })),
    effectiveSettings: win.filter((m) => m.name === "pipe.effective-settings").reduce((a, m) => ({ n: a.n + 1, ms: a.ms + m.ms, max: Math.max(a.max, m.ms) }), { n: 0, ms: 0, max: 0 }),
    probes: win.filter((m) => m.name === "acp.request" && m.method === "session/new" && !m.sessionId).length,
    appendLog: win.filter((m) => m.name === "sessions.append-log-batch").map((m) => ({ ms: m.ms, chars: m.chars })),
    ingestTurn: win.filter((m) => m.name === "pipe.ingest-turn").map((m) => m.ms),
    validate: win.filter((m) => m.name === "pipe.validate").map((m) => ({ tokens: m.tokens, unverified: m.unverified, repair: m.needsRepairTurn })),
    innerRetries: win.filter((m) => m.name === "pipe.inner-retry").map((m) => m.error),
    forkFallbacks: win.filter((m) => m.name === "pipe.fork-fallback").map((m) => m.error),
    store: (() => {
      const g = win.filter((m) => m.name === "store.get");
      const mu = win.filter((m) => m.name === "store.mutate");
      return {
        gets: g.length,
        getMs: Math.round(g.reduce((n, m) => n + m.ms, 0)),
        mutates: mu.length,
        mutateMs: Math.round(mu.reduce((n, m) => n + m.ms, 0)),
        maxBytes: Math.max(0, ...g.map((m) => m.bytes), ...mu.map((m) => m.bytes)),
      };
    })(),
    mcp: win.filter((m) => m.name === "mcp.tool").map((m) => ({ tool: m.tool, ms: m.ms, role: m.role })),
  };
  // Turns in the window on sessions no job in this flow owns (thread replies
  // run on the thread's session; base builds; log appends).
  const owned = new Set(flowJobs.map((j) => j.sessionId).filter(Boolean));
  row.otherTurns = [...turns.entries()]
    .filter(([sid]) => !owned.has(sid))
    .flatMap(([sid, ts]) => ts.filter((t) => t.start >= f.startedAt - 50 && t.start <= (f.endedAt ?? Infinity)).map((t) => ({ sessionId: sid.slice(0, 8), at: t.start - f.startedAt, promptChars: t.promptChars, firstThought: t.firstThoughtMs, ttft: t.firstTextMs, ms: t.responseMs, usage: t.usage })));
  result.flows.push(row);
}
result.baseBuilds = marks.filter((m) => m.name === "sessions.base-build").map((m) => ({ t: m.t, ms: m.ms, packChars: m.packChars, guide: m.key.split("|")[2] }));
result.adapter = marks.filter((m) => m.name === "acp.adapter-start").map((m) => ({ provider: m.provider, ms: m.ms }));

// Totals: every turn in the run (jobs, base builds, log appends, probes).
const allTurns = [...turns.values()].flat();
const tot = { turns: allTurns.length, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, byModel: {} };
for (const t of allTurns) {
  if (!t.usage) continue;
  tot.input += t.usage.input;
  tot.cacheRead += t.usage.cacheRead;
  tot.cacheWrite += t.usage.cacheWrite;
  tot.output += t.usage.output;
  const key = `${t.provider}/${t.model}`;
  const b = (tot.byModel[key] ??= { turns: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  b.turns += 1;
  b.input += t.usage.input;
  b.cacheRead += t.usage.cacheRead;
  b.cacheWrite += t.usage.cacheWrite;
  b.output += t.usage.output;
}
result.totals = tot;
// Turns that belong to no job (base builds, log appends).
const jobSessions = new Set([...jobs.values()].map((j) => j.sessionId).filter(Boolean));
result.nonJobTurns = [...turns.entries()]
  .filter(([sid]) => !jobSessions.has(sid))
  .flatMap(([sid, ts]) => ts.map((t) => ({ sessionId: sid.slice(0, 8), promptChars: t.promptChars, ttft: t.firstTextMs, ms: t.responseMs, usage: t.usage, at: t.start })));

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`# ${label} (${run.provider}; main ${run.settings?.main?.provider}/${run.settings?.main?.model}, small ${run.settings?.small?.provider}/${run.settings?.small?.model})\n`);
for (const f of result.flows) {
  console.log(`## ${f.name}   load ${f.load?.join(" ")}${f.error ? `   ERROR ${f.error}` : ""}`);
  console.log(`visible (s from click): ${Object.entries(f.rel ?? {}).map(([k, v]) => `${k} ${s1(v)}`).join(" | ")}`);
  if (f.cmds.length) console.log(`git/gh: ${f.cmds.map((c) => `[${s1(c.at)}s] ${c.cmd} = ${c.ms}ms`).join("; ")}`);
  if (f.baseBuilds.length) console.log(`base builds: ${f.baseBuilds.map((b) => `${s1(b.ms)}s (pack ${b.packChars} chars, ${b.key}, ended at ${s1(b.endAt)}s)`).join("; ")}`);
  if (f.preEnqueueBase.length) console.log(`ensureBase before enqueue: ${f.preEnqueueBase.map((b) => `${b.kind} ${s1(b.ms)}s`).join("; ")}`);
  if (f.appendLog.length) console.log(`base log appends: ${f.appendLog.map((b) => `${s1(b.ms)}s`).join("; ")}`);
  console.log(`effective-settings calls ${f.effectiveSettings.n} (sum ${Math.round(f.effectiveSettings.ms)}ms, max ${Math.round(f.effectiveSettings.max)}ms), model probes ${f.probes}; store gets ${f.store.gets} (${f.store.getMs}ms) mutates ${f.store.mutates} (${f.store.mutateMs}ms) snapshot ≤${f.store.maxBytes}B; ingest-turn ${f.ingestTurn.map((x) => Math.round(x)).join("/") || "–"}ms`);
  if (f.validate.some((v) => v.repair)) console.log(`REPAIR TURNS: ${JSON.stringify(f.validate.filter((v) => v.repair))}`);
  if (f.innerRetries.length) console.log(`INNER RETRIES: ${f.innerRetries.join(" | ")}`);
  if (f.forkFallbacks.length) console.log(`FORK FALLBACKS: ${f.forkFallbacks.join(" | ")}`);
  if (f.otherTurns.length) console.log(`other turns in window (replies on the thread session, base builds, log appends): ${f.otherTurns.map((t) => `[${s1(t.at)}s] ${t.promptChars} chars: thought ${s1(t.firstThought)} ttft ${s1(t.ttft)} turn ${s1(t.ms)} in/read/write/out ${t.usage ? `${t.usage.input}/${t.usage.cacheRead}/${t.usage.cacheWrite}/${t.usage.output}` : "?"}`).join("; ")}`);
  if (f.mcp.length) console.log(`mcp tools: ${f.mcp.map((m) => `${m.tool} ${Math.round(m.ms)}ms`).join(", ")}`);
  if (f.jobs.length) {
    console.log("| job | model | queue | setup | 1st thought | TTFT | turn(s) | tools | grace | post | total | in | cache-read | cache-write | out | setup requests |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const j of f.jobs) {
      console.log(
        `| ${j.kind}${j.state !== "done" ? ` (${j.state})` : ""}${j.turns > 1 ? ` ×${j.turns} turns` : ""}${j.attempts > 1 ? ` ×${j.attempts} attempts` : ""} | ${j.model} | ${s1(j.queueWait)} | ${s1(j.setup)} | ${s1(j.firstThought)} | ${s1(j.ttft)} | ${s1(j.turnMs)} | ${j.tools} (${s1(j.toolMs)}) | ${s1(j.grace)} | ${s1(j.post)} | ${s1(j.total)} | ${j.usage.input} | ${j.usage.cacheRead} | ${j.usage.cacheWrite} | ${j.usage.output} | ${j.setupRequests} |`,
      );
    }
  }
  console.log("");
}
console.log(`## totals\n${JSON.stringify(result.totals, null, 2)}`);
console.log(`non-job turns (base builds, log appends): ${JSON.stringify(result.nonJobTurns)}`);
