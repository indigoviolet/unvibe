/*global console process Buffer setTimeout clearTimeout*/
// Live panel check (#322 part 2, Step 1), run as:
//   mise run test:live:panel-322 -- --cap 0.25 [--provider pi] [--model <id>]
//
// The model is a flag (default pi + muse-spark-1.3-contributor via
// live-pi-lib); the owner picks the rerun model. Real pi answers
// fixture questions with
// three active fixture repos available (synthetic public-style fixtures
// created in a temp dir; never any private repo). The pilot (first
// question, spanning two repos) runs first: on a 403 / auth error the
// harness stops before any further spend. Spend is tracked from the
// first token (failed turns included) via scripts/live-pi-lib.mjs and
// the report lands in test-results/.
//
// The live session gets no GitHub write credentials: GITHUB_TOKEN is
// unset and a fake `gh` that refuses writes is first on PATH. pi runs
// read-only (--tools read,ls), --no-session, in the fixture root.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPriced, createSpendTracker, fetchPiCatalog, findCatalogEntry,
  formatUsd, parseLiveArgs, precheckModelOffered, preflightCap,
  resolvePiCmd, worstCaseTurnUsd, writeLiveReport,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let live;
try { live = parseLiveArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
const PI_CMD = resolvePiCmd();

const SYSTEM = [
  "You are a read-only assistant for a code question panel.",
  "Active repos (folder -> slug): service/ -> acme/service, client/ -> acme/client, shared/ -> acme/shared.",
  "Read files with the read/ls tools only, only inside those folders. Never guess code you have not read.",
  "Cite every code claim repo-qualified as code:owner/name:path:start-end, e.g. code:acme/service:src/auth.ts:1-5.",
  "If the answer is in no active repo, say so plainly and tell the user to add the repo to Active repos. Do not invent an answer.",
].join(" ");

const QUESTIONS = [
  { id: "pilot-two-repos", text: "How do validateToken in acme/service and fetchSession in acme/client work together to check a session? Read the relevant files and cite them repo-qualified." },
  { id: "client-and-shared", text: "What shape does fetchSession in acme/client return, and how does the Session type in acme/shared describe that shape? Read the relevant files and cite them repo-qualified." },
  { id: "service-expiry", text: "When does tokenExpiry in acme/service return a non-zero value? Read the relevant file and cite it repo-qualified." },
  { id: "no-repo-billing", text: "How are credit-card charges billed and retried when a payment fails? Read the relevant files and cite them repo-qualified." },
  { id: "service-and-shared", text: "Does the Session type in acme/shared say anything about token expiry in acme/service? Read the relevant files and cite them repo-qualified." },
];

function makeFixtures(root) {
  const w = (rel, body) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  w("service/src/auth.ts", 'export function validateToken(token: string): boolean {\n  if (!token.startsWith("sess_")) return false;\n  const parts = token.split("_");\n  return parts.length === 3 && parts[2].length >= 8;\n}\nexport function tokenExpiry(token: string): number {\n  return validateToken(token) ? 3600 : 0;\n}\n');
  w("client/src/client.ts", 'import { validateToken } from "../../service/src/auth";\nimport type { Session } from "../../shared/src/types";\nexport async function fetchSession(token: string): Promise<Session> {\n  if (!validateToken(token)) throw new Error("invalid session token");\n  return { userId: "u_42", expiresIn: 3600 };\n}\n');
  w("shared/src/types.ts", "export interface Session { userId: string; expiresIn: number; }\n");
}

let piProvider = "meta";
let piModel = live.model;
function runQuestion(root, env, q) {
  return new Promise((resolve) => {
    const child = spawn(PI_CMD[0], [...PI_CMD.slice(1),
      "--mode", "json", "-p", "--no-session", "--no-context-files",
      "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes",
      "--provider", piProvider, "--model", piModel, "--tools", "read,ls",
      "--system-prompt", SYSTEM, q.text,
    ], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 180000);
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ q, error: String(e), reads: [], answer: "", usage: null, raw: err }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const reads = []; let answer = ""; let usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
      let authError = null;
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "tool_execution_start" && (e.toolName === "read" || e.toolName === "ls")) reads.push(`${e.toolName}:${e.args?.path ?? ""}`);
        const m = e.message;
        if (m?.role === "assistant" && m.usage) {
          usage.inputTokens += m.usage.input ?? 0; usage.outputTokens += m.usage.output ?? 0;
          usage.cachedReadTokens += m.usage.cacheRead ?? 0; usage.cachedWriteTokens += m.usage.cacheWrite ?? 0;
        }
        if (e.type === "agent_end") {
          for (const msg of e.messages ?? []) if (msg.role === "assistant") for (const c of msg.content ?? []) if (c.type === "text") answer = c.text;
        }
        const blob = JSON.stringify(e);
        if (/403|client_attestation_denied|unauthori[sz]ed|auth/i.test(blob) && e.type !== "session") {
          if (/403|client_attestation_denied/.test(blob)) authError = blob.slice(0, 300);
        }
      }
      const citations = [...new Set(answer.match(/code:[a-z0-9-]+\/[a-z0-9-]+:[^\s`]+/gi) ?? [])];
      const reposCited = [...new Set(citations.map((c) => c.split(":")[1]))];
      const reposRead = [...new Set(reads.filter((r) => r.startsWith("read:")).map((r) => r.slice(5).split("/")[0]))]
        .map((d) => ({ service: "acme/service", client: "acme/client", shared: "acme/shared" })[d] ?? d);
      resolve({ q, code, error: authError ?? (code !== 0 ? (err.slice(0, 300) || `pi exited ${code}`) : null), reads, reposRead, reposCited, citations, answer, usage });
    });
  });
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-panel-322-"));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-panel-fakebin-"));
try {
  makeFixtures(fixtureRoot);
  fs.writeFileSync(path.join(fakeBin, "gh"), "#!/bin/sh\necho 'fake gh: writes refused' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1", PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` };
  delete env.GITHUB_TOKEN; delete env.GH_TOKEN;
  const hit = precheckModelOffered(PI_CMD, live, { env });
  piProvider = hit.provider;
  piModel = hit.model;
  const catalog = await fetchPiCatalog(PI_CMD, { env });
  const entry = findCatalogEntry(catalog, live);
  const rates = assertPriced(entry, live);
  preflightCap({ capUsd: live.capUsd, worstCaseUsd: worstCaseTurnUsd(rates, entry), what: "one full-context turn" });
  const tracker = createSpendTracker(rates, live.capUsd);
  const results = [];
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q.id}: ${q.text}`);
    const r = await runQuestion(fixtureRoot, env, q);
    if (r.usage) { tracker.add(r.usage); }
    const spend = tracker.usd();
    console.log(`reads: ${r.reads.join(", ") || "none"}\nreposRead: ${r.reposRead?.join(", ") || ""}\nreposCited: ${r.reposCited?.join(", ") || ""}\ncitations: ${(r.citations ?? []).join(" ")}\nanswer: ${r.answer}\nspendSoFar: ${formatUsd(spend)} / cap ${formatUsd(live.capUsd)}`);
    results.push({ id: q.id, question: q.text, reads: r.reads, reposRead: r.reposRead, reposCited: r.reposCited, citations: r.citations, answer: r.answer, usage: r.usage, error: r.error, spendSoFarUsd: spend });
    if (r.error && /403|client_attestation_denied/i.test(r.error)) {
      console.error(`STOP: auth error on ${q.id}: ${r.error}`);
      writeLiveReport({ dir: path.join(ROOT, "test-results"), task: "panel-322", provider: live.provider, model: live.model, capUsd: live.capUsd, totalSpendUsd: spend, stopped: "auth-403", results });
      process.exit(3);
    }
    try { tracker.check(q.id); } catch (e) { console.error(e.message); break; }
  }
  const total = tracker.usd();
  console.log(`\nTOTAL SPEND: ${formatUsd(total)} (cap ${formatUsd(live.capUsd)}), tokens ${JSON.stringify(tracker.totals)}`);
  writeLiveReport({ dir: path.join(ROOT, "test-results"), task: "panel-322", provider: live.provider, model: live.model, capUsd: live.capUsd, totalSpendUsd: total, totals: tracker.totals, results });
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
}
