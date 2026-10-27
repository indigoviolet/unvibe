/*global console process setTimeout Buffer clearTimeout */
// Live D2 feature reliability run (issue #286), run as:
//   mise run test:live:diagram [--provider claude|codex|both] [--port N]
//     [--cap 5] [--tasks containers,icons,...]
//
// Spins up the BUILT service with the default ACP runner (real claude/codex
// logins; real token spend), creates the demo review (fast ingest, no git
// needed), and runs one `ask` per D2 feature group per provider. Each ask
// message steers the model at exactly one lifted feature; the reply's
// fenced d2 goes through the real pipeline (cite validation +
// compile-check + render + exactly one repair turn), and the harness
// records per-task render/cite results, feature presence, and icon drops.
//
// OUT OF SCOPE: animation and boards stay banned (filed as #287) — there
// are no tasks for them.
//
// Cost control: the harness enforces its own $5 cap (override with --cap).
// Usage comes from `GET /api/jobs?review=:id` (TokenUsage per job); every
// model is priced at the Opus list ceiling (over-estimate for Codex, so the
// cap binds early). Before each generation the harness checks
// spent + WORST_NEXT_USD against the cap and stops (writing the report)
// before going over.
//
// Report: test-results/live-diagram-286-<timestamp>.json (gitignored) with
// the actual spend, per-task render/cite results, and the icon-drop count
// and URLs — not only the console.
//
// Never run by `mise run check`. Requires built service (`mise run build`),
// logged-in `claude`/`codex` CLIs, and `d2` ≥ 0.9.0 on PATH. DO NOT RUN
// without the owner's explicit cap approval (the spend is real).
import { spawn } from "node:child_process";
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

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const PORT = Number(argOf("--port", "4597"));
const onlyProvider = argOf("--provider", "both");
const CAP_USD = Number(argOf("--cap", "5"));
const onlyTasks = argOf("--tasks", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PROVIDERS = ["claude", "codex"].filter((p) => onlyProvider === "both" || p === onlyProvider);
if (PROVIDERS.length === 0) {
  console.error(`unknown --provider ${onlyProvider} (want claude|codex|both)`);
  process.exit(2);
}

/** Stop-before-over cap: worst-case cost assumed for one more generation + repair. */
const WORST_NEXT_USD = 0.6;

// List-price ceiling, USD per million tokens (Anthropic Opus-class list:
// 15 in / 75 out / 18.75 cache-write / 1.50 cache-read). EVERY model is
// priced here (an over-estimate for Codex), so the $5 cap binds early.
const RATES = { in: 15, out: 75, cw: 18.75, cr: 1.5 };
function costOf(u) {
  return (
    ((u.inputTokens ?? 0) * RATES.in +
      (u.outputTokens ?? 0) * RATES.out +
      (u.cachedWriteTokens ?? 0) * RATES.cw +
      (u.cachedReadTokens ?? 0) * RATES.cr) /
    1_000_000
  );
}

/**
 * One task per lifted feature group. `ask` steers the model at the feature;
 * `want` is the source-level signal the harness looks for (a miss is a
 * model-reliability signal, not a harness failure).
 */
const TASKS = [
  {
    id: "containers",
    ask: "Draw exactly one fenced d2 diagram of this change that groups the parsing stages in containers (e.g. parser: { msg: ..., norm: ... }).",
    want: /\w+\s*:\s*\{[^}]*\w+\s*:/s,
    hint: "nested container block",
  },
  {
    id: "edge-dash",
    ask: "Draw exactly one fenced d2 diagram of this change that marks the optional path with a dashed edge: redeclare the edge on its own line as `a -> b: {style: {stroke-dash: 4}}` after the labeled edge.",
    want: /stroke-dash/,
    hint: "stroke-dash style line",
  },
  {
    id: "arrowheads",
    ask: "Draw exactly one fenced d2 diagram of this change that marks the decision edge with a diamond head: `a -> b: {target-arrowhead: {shape: diamond}}` beside the label, never inside style:.",
    want: /target-arrowhead/,
    hint: "target-arrowhead beside the label",
  },
  {
    id: "grid",
    ask: "Draw exactly one fenced d2 diagram of this change that shows before/after side by side with `grid-rows: 1` and `grid-columns: 2`.",
    want: /grid-(rows|columns)/,
    hint: "grid-rows/grid-columns",
  },
  {
    id: "sql-class",
    ask: "Draw exactly one fenced d2 diagram of this change that shows the changed mapping as a `shape: sql_table` (cites go on the TABLE, never on rows).",
    want: /shape:\s*(sql_table|class)/,
    hint: "shape: sql_table",
  },
  {
    id: "shapes",
    ask: "Draw exactly one fenced d2 diagram of this change that uses meaningful shapes: a cylinder for the stored headers and a queue for the buffered value.",
    want: /shape:\s*(cylinder|queue|person|cloud|diamond|package|callout|c4-person)/,
    hint: "meaningful shape",
  },
  {
    id: "code-label",
    ask: "Draw exactly one fenced d2 diagram of this change that labels the key node with the exact changed line as a code label (e.g. `norm: |python value.replace(pat, \" \") |`).",
    want: /\|\s*[a-z]+\s[^|]*\|/i,
    hint: "|lang code label",
  },
  {
    id: "seq-spans",
    ask: "Draw exactly one fenced d2 diagram of this change as a `shape: sequence_diagram` with an activation span (`a -> a.hold: label`).",
    want: /shape:\s*sequence_diagram[\s\S]*->\s*\w+\.\w+/,
    hint: "sequence span (a -> a.x)",
  },
  {
    id: "seq-self",
    ask: "Draw exactly one fenced d2 diagram of this change as a `shape: sequence_diagram` with a self-message (`a -> a: label`).",
    want: /(\w+)\s*->\s*\1\s*:/,
    hint: "self-message (a -> a)",
  },
  {
    id: "seq-notes",
    ask: "Draw exactly one fenced d2 diagram of this change as a `shape: sequence_diagram` with a participant note (`participant.note: \"text\"` — never a bare note: line).",
    want: /\.note\s*:/,
    hint: "participant.note:",
  },
  {
    id: "md-latex",
    ask: "Draw exactly one fenced d2 diagram of this change that uses a `|md` label with bold text and a `|latex` label for the key expression.",
    want: /\|\s*(md|latex)\b/,
    hint: "|md / |latex label",
  },
  {
    id: "icons",
    ask: "Draw exactly one fenced d2 diagram of this change that decorates the risky node with an icon copied VERBATIM from the convention's icon list (exact `icon: https://icons.terrastruct.com/...` form).",
    want: /icon:\s*https:\/\/icons\.terrastruct\.com\//,
    hint: "allowlisted icon URL",
  },
  {
    id: "caps-scale",
    ask: "Draw exactly one fenced d2 diagram of this change that covers the whole flow end to end with as many shapes as it takes (up to 20).",
    want: null,
    hint: "renders above the old 12-shape cap",
  },
].filter((t) => onlyTasks.length === 0 || onlyTasks.includes(t.id));
if (TASKS.length === 0) {
  console.error(`no tasks match --tasks ${onlyTasks.join(",")} (want: ${TASKS.map((t) => t.id).join(",")})`);
  process.exit(2);
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-diagram-data-"));
const ENV = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0" };
delete ENV.UNVIBE_AGENT; // default ACP runner (real agents)
ENV.UNVIBE_ALLOW_LIVE_AGENT = "1";

function api(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: apiPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text: data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitJob(token, reviewId, jobId, what) {
  for (let i = 0; i < 180; i++) {
    const jobs = (await api("GET", `/api/jobs?review=${reviewId}`, undefined, token)).json;
    const job = jobs.jobs?.find((j) => j.id === jobId);
    if (job && ["done", "error", "cancelled"].includes(job.state)) {
      if (job.state !== "done") throw new Error(`${what}: job ${job.state}: ${job.error ?? ""}`);
      return job;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${what}: job ${jobId} never settled`);
}

/** Sum usage over this review's jobs since `seen` (job ids already counted). */
async function newUsage(token, reviewId, seen) {
  const jobs = (await api("GET", `/api/jobs?review=${reviewId}`, undefined, token)).json;
  const usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0, unmetered: 0 };
  for (const j of jobs.jobs ?? []) {
    if (seen.has(j.id)) continue;
    if (!j.usage) {
      // A finished job that reports no usage still spent: count it at the
      // worst case so the cap can't be undercounted.
      if (["done", "error", "cancelled"].includes(j.state)) {
        seen.add(j.id);
        usage.unmetered += 1;
      }
      continue;
    }
    seen.add(j.id);
    usage.inputTokens += j.usage.inputTokens ?? 0;
    usage.cachedReadTokens += j.usage.cachedReadTokens ?? 0;
    usage.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
    usage.outputTokens += j.usage.outputTokens ?? 0;
  }
  return usage;
}

/** Every diagram block in the snapshot, with its card/block address. */
function allDiagrams(snap) {
  const out = [];
  for (const p of snap.pages ?? []) {
    for (const c of p.cards ?? []) {
      for (const b of c.blocks ?? []) {
        if (b.type === "diagram") out.push(b);
        if (b.type === "aside") {
          for (const inner of b.inner ?? []) if (inner.type === "diagram") out.push(inner);
        }
      }
    }
  }
  for (const a of snap.annotations ?? []) {
    for (const t of a.replies ?? []) {
      for (const b of t.blocks ?? []) {
        if (b.type === "diagram") out.push(b);
        if (b.type === "aside") {
          for (const inner of b.inner ?? []) if (inner.type === "diagram") out.push(inner);
        }
      }
    }
  }
  return out;
}

async function main() {
  const child = spawn(process.execPath, [CLI, "start", "--port", String(PORT)], {
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let token = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service did not print a token URL")), 30000);
    child.stdout.on("data", (d) => {
      const m = String(d).match(/token=([A-Za-z0-9_-]+)/);
      if (m && !token) {
        token = m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", () => {
      // service logs drain here
    });
    child.on("exit", (c) => reject(new Error(`service exited ${c}`)));
  });
  try {
    await ready;
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch (e) {
      void e;
    }
  };
  process.on("exit", stop);

  const report = {
    generatedAt: new Date().toISOString(),
    issue: 286,
    capUsd: CAP_USD,
    worstNextUsd: WORST_NEXT_USD,
    rates: { ...RATES, note: "Opus list ceiling applied to every model (over-estimate for Codex)" },
    tasks: TASKS.map((t) => t.id),
    providers: {},
    totals: { costUsd: 0, rendersOk: 0, citesOk: 0, featureHits: 0, iconDrops: 0, iconDropUrls: [] },
    status: "complete",
  };
  const reportPath = path.join(
    ROOT,
    "test-results",
    `live-diagram-286-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const seenJobs = new Set();
  const writeReport = () => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  };
  const addCost = (prov, u) => {
    const c = costOf(u) + (u.unmetered ?? 0) * WORST_NEXT_USD;
    report.providers[prov].costUsd = Math.round((report.providers[prov].costUsd + c) * 10000) / 10000;
    report.totals.costUsd = Math.round((report.totals.costUsd + c) * 10000) / 10000;
    const t = report.providers[prov].usage;
    t.inputTokens += u.inputTokens;
    t.cachedReadTokens += u.cachedReadTokens;
    t.cachedWriteTokens += u.cachedWriteTokens;
    t.outputTokens += u.outputTokens;
  };

  try {
    for (const provider of PROVIDERS) {
      report.providers[provider] = {
        model: null,
        usage: { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 },
        costUsd: 0,
        tasks: [],
      };
      const created = await api("POST", "/api/reviews", { repoId: "demo" }, token);
      if (created.status !== 201) throw new Error(`create demo review: ${created.status} ${created.text}`);
      const id = created.json.review.id;

      // Wait for the central card (reader on the default main provider).
      let snap = null;
      for (let i = 0; i < 120; i++) {
        const r = await api("GET", `/api/reviews/${id}`, undefined, token);
        snap = r.json;
        if (snap?.pages?.find((p) => p.id === "root")?.cards?.find((c) => c.id === "central")?.blocks?.length) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      const central = snap?.pages?.find((p) => p.id === "root")?.cards?.find((c) => c.id === "central");
      if (!central) throw new Error(`${provider}: central card never filled`);
      addCost(provider, await newUsage(token, id, seenJobs));

      // Point the main role at this provider (keep the offered model).
      const settings = (await api("GET", "/api/settings", undefined, token)).json;
      const model = settings.main.provider === provider ? settings.main.model : settings.main.model;
      await api("PUT", "/api/settings", { main: { provider, model }, autoGoDeeper: false }, token);
      report.providers[provider].model = `${provider}/${model}`;

      const firstBlock = (central.blocks ?? []).find((b) => b.type === "paragraph" || b.type === "code");
      const rawText =
        typeof firstBlock?.text === "string" ? firstBlock.text : (firstBlock?.text?.standard ?? central.title ?? "");
      const quoteSource = rawText || "obsolete line folding";
      const quote = String(quoteSource).split("\n").find((l) => l.trim())?.slice(0, 160) ?? "obsolete line folding";
      const anchorBlock = (central.blocks ?? [])[0];
      if (!anchorBlock?.id) throw new Error(`${provider}: central card has no blocks to anchor on`);
      const anchor = { where: "block", blockId: anchorBlock.id };

      for (const task of TASKS) {
        // Cap gate: stop BEFORE going over, then write the report.
        if (report.totals.costUsd + WORST_NEXT_USD > CAP_USD) {
          report.status = "cap-reached";
          console.log(`CAP: spent $${report.totals.costUsd.toFixed(2)} + worst-next $${WORST_NEXT_USD} > $${CAP_USD} — stopping`);
          writeReport();
          console.log(`report: ${reportPath}`);
          return;
        }
        const before = new Set(allDiagrams(snap).map((d) => d.render?.hash).filter(Boolean));
        const acted = await api(
          "POST",
          `/api/reviews/${id}/actions`,
          {
            kind: "ask",
            quote,
            anchor,
            message: `${task.ask} Cite code with inline link: cites (at least 2) and keep every label short.`,
          },
          token,
        );
        if (acted.status !== 200) throw new Error(`${provider}/${task.id}: ask ${acted.status} ${acted.text}`);
        const annotationId = acted.json.annotationId;
        const jobId = acted.json.jobId;
        if (jobId) await waitJob(token, id, jobId, `${provider}/${task.id}`);
        await new Promise((r) => setTimeout(r, 3000));
        addCost(provider, await newUsage(token, id, seenJobs));
        snap = (await api("GET", `/api/reviews/${id}`, undefined, token)).json;
        const fresh = allDiagrams(snap).filter((d) => !before.has(d.render?.hash));
        const dg = fresh.filter((d) => d.id !== undefined).pop() ?? fresh.pop();
        const result = { id: task.id, provider, rendersOk: false, citesOk: false, featureHit: false, iconDrops: [] };
        if (!dg) {
          result.error = "no new diagram block stored";
        } else {
          result.renderStatus = dg.render?.status ?? null;
          result.renderError = dg.render?.error ?? null;
          result.rendersOk = dg.render?.status === "ok";
          const cites = (dg.citations ?? []).map((c) => c.target);
          result.cites = cites.length;
          result.citesOk = cites.length >= 2;
          result.featureHit = task.want === null ? null : task.want.test(dg.source ?? "");
          if (task.id === "caps-scale") {
            const keys = new Set(
              String(dg.source ?? "")
                .split("\n")
                .map((l) => l.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*(?:\.[A-Za-z0-9_*-]+\s*)?:/)?.[1]?.split(".")[0])
                .filter(Boolean),
            );
            result.shapes = keys.size;
            result.featureHit = keys.size > 12;
          }
          const notes = (dg.render?.notes ?? []).filter((n) => n.startsWith("icon stripped:"));
          result.iconDrops = notes;
          if (result.rendersOk) report.totals.rendersOk++;
          if (result.citesOk) report.totals.citesOk++;
          if (result.featureHit) report.totals.featureHits++;
          report.totals.iconDrops += notes.length;
          for (const n of notes) {
            const url = n.replace(/^icon stripped:\s*/, "").split(":")[0];
            if (!report.totals.iconDropUrls.includes(url)) report.totals.iconDropUrls.push(url);
          }
        }
        void annotationId;
        report.providers[provider].tasks.push(result);
        console.log(
          `live-diagram ${provider}/${task.id}: render=${result.rendersOk} cites=${result.citesOk} feature=${result.featureHit} iconDrops=${result.iconDrops.length}${result.error ? ` ERROR ${result.error}` : ""} (spent $${report.totals.costUsd.toFixed(2)})`,
        );
        writeReport();
      }
    }
    console.log(
      `live-diagram: ${report.status} — $${report.totals.costUsd.toFixed(2)} spent, ` +
        `${report.totals.rendersOk} renders ok, ${report.totals.citesOk} cite-ok, ` +
        `${report.totals.featureHits} feature hits, ${report.totals.iconDrops} icon drops`,
    );
    console.log(`report: ${reportPath}`);
  } finally {
    writeReport();
    stop();
  }
}

main().catch((e) => {
  console.error(`live-diagram FAILED: ${(e && e.message) || e}`);
  process.exit(1);
});
