/*global console process setTimeout clearTimeout */
// `mise run test:live:installed` (needs UNVIBE_LIVE=1, agent logins; tiny
// token spend: one short prompt per provider). Runs one real session per
// provider (claude, codex; UNVIBE_LIVE_PROVIDERS filters) against the
// INSTALLED copy's bundled adapters (`mise run release` first): spawns
// `<prefix>/lib/node_modules/unvibe/packages/service/dist/adapters/*.js`
// with CODEX_PATH / CLAUDE_CODE_EXECUTABLE pointed at the user's real CLIs,
// drives initialize → session/new (codename system prompt) → prompt → close
// over ACP stdio, and asserts:
// - the adapter's direct child process IS the user's executable (ps tree),
// - the session works end to end (codename recalled, usage reported).
// Read-only posture, fork, and cache behaviour are covered by `test:live`
// against the source tree; this proves the shipped bundles work.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(ROOT, "package.json"));
const acp = req("@agentclientprotocol/sdk");

const LIVE = process.env.UNVIBE_LIVE === "1";
const PROVIDERS = (process.env.UNVIBE_LIVE_PROVIDERS ?? "claude,codex").split(",").map((s) => s.trim()).filter(Boolean);

if (!LIVE) {
  console.log("live-installed: skipped (needs UNVIBE_LIVE=1)");
  process.exit(0);
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};
const ok = (msg) => console.log(`ok: ${msg}`);

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  const p = (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)[0];
  return p && fs.existsSync(p) ? p : null;
}

function binVersion(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
  const m = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : "(unknown)";
}

/** Direct children (pid + command) of a pid, via ps (macOS + Linux). */
function childProcesses(pid) {
  const r = spawnSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8", timeout: 10000 });
  const out = [];
  for (const line of (r.stdout ?? "").split("\n").slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m && Number(m[2]) === pid) out.push({ pid: Number(m[1]), args: m[3] });
  }
  return out;
}

function installRelease() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const tarball = path.join(ROOT, `unvibe-${version}.tgz`);
  if (!fs.existsSync(tarball)) {
    console.error(`live-installed: missing ${tarball} — run \`mise run release\` first`);
    process.exit(1);
  }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-installed-"));
  const PREFIX = path.join(TMP, "prefix");
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal install, no flags (the release needs none).
  const r = spawnSync("npm", ["install", "-g", tarball, "--prefix", PREFIX], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    timeout: 600_000,
  });
  if (r.status !== 0) {
    console.error((r.stdout ?? "").slice(-2000), (r.stderr ?? "").slice(-2000));
    console.error("live-installed: release install failed");
    process.exit(1);
  }
  return { TMP, PREFIX };
}

async function runProvider({ provider, adapterEntry }) {
  const cli = provider === "claude" ? "claude" : "codex";
  const bin = which(cli);
  if (!bin) {
    fail(`${provider}: ${cli} CLI not found on PATH`);
    return;
  }
  const ver = binVersion(bin);
  const codename = `QUOKKA-${provider === "claude" ? "C" : "X"}7-INST`;
  const systemPrompt = `Your codename for this session is ${codename}. When asked for your codename, reply with just the codename and nothing else.`;

  const proc = spawn(process.execPath, [adapterEntry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(provider === "claude" ? { CLAUDE_CODE_EXECUTABLE: bin } : { CODEX_PATH: bin }),
      NO_BROWSER: "1",
    },
  });
  if (!proc.stdin || !proc.stdout || !proc.pid) {
    fail(`${provider}: adapter failed to spawn`);
    return;
  }
  const diesel = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
  }, 240_000);
  diesel.unref?.();

  let procError = null;
  try {
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout);
    const stream = acp.ndJsonStream(input, output);
    const pending = [];
    const wakers = new Set();
    const wake = () => { for (const w of [...wakers]) w(); };
    const conn = acp.client({ name: "unvibe-live-installed" })
      .onRequest("session/request_permission", async () => ({ outcome: { outcome: "cancelled" } }))
      .onNotification("session/update", async (ctx) => {
        pending.push(ctx.params?.update);
        wake();
      })
      .connect(stream);
    const request = (method, params) => conn.agent.request(method, params);

    await request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-inst-"));
    const meta =
      provider === "claude"
        ? { systemPrompt }
        : { jetbrains: { air: { version: 1, customInstructions: systemPrompt } } };
    const created = await request("session/new", { cwd, mcpServers: [], _meta: meta });
    const sessionId = created?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) throw new Error("session/new returned no sessionId");

    // The process that actually runs must be the user's executable.
    await new Promise((r) => setTimeout(r, 3000));
    const kids = childProcesses(proc.pid);
    const hit = kids.find((k) => k.args.startsWith(bin) || k.args.includes(` ${bin} `) || k.args === bin);
    if (!hit) throw new Error(`no child of the adapter runs ${bin} (saw: ${kids.map((k) => k.args.slice(0, 80)).join(" | ") || "none"})`);
    ok(`${provider}: runs the user's executable (${bin} ${ver}; child: ${hit.args.slice(0, 100)})`);

    const seen = [];
    const respP = request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "What is your codename? Reply with just the codename and nothing else." }],
    });
    let resp = null;
    let done = false;
    const waiter = (async () => {
      try { resp = await respP; } catch (e) { procError = e; } finally { done = true; wake(); }
    })();
    void waiter;
    while (!done) {
      while (pending.length > 0) seen.push(pending.shift());
      if (done) break;
      await new Promise((resolve) => {
        wakers.add(resolve);
        setTimeout(resolve, 50);
      });
      for (const w of [...wakers]) { wakers.delete(w); }
    }
    while (pending.length > 0) seen.push(pending.shift());
    if (procError) throw procError;
    const text = seen
      .filter((u) => u?.sessionUpdate === "agent_message_chunk" && u?.content?.type === "text")
      .map((u) => u.content.text)
      .join("");
    if (!text.includes(codename)) throw new Error(`codename not recalled (got: ${JSON.stringify(text).slice(0, 200)})`);
    const usage = resp?.usage;
    if (!usage) throw new Error("prompt response carried no usage");
    ok(`${provider}: session works end to end from the installed copy (codename recalled, stop=${resp?.stopReason ?? "?"})`);
    try {
      await request("session/close", { sessionId });
    } catch { /* best-effort */ }
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch (e) {
    fail(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(diesel);
    try { proc.kill(); } catch { /* gone */ }
    try { proc.stdin?.destroy(); } catch { /* gone */ }
  }
}

const main = async () => {
  const { TMP, PREFIX } = installRelease();
  const installed = path.join(PREFIX, "lib", "node_modules", "unvibe");
  for (const provider of PROVIDERS) {
    if (provider !== "claude" && provider !== "codex") {
      fail(`unknown provider ${JSON.stringify(provider)}`);
      continue;
    }
    const entry = path.join(installed, "packages", "service", "dist", "adapters", `${provider}.js`);
    if (!fs.existsSync(entry)) {
      fail(`${provider}: missing installed adapter bundle (${entry})`);
      continue;
    }
    await runProvider({ provider, adapterEntry: entry });
  }
  if (failures > 0) {
    console.error(`${failures} failure(s) (work dir kept: ${TMP})`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("live-installed: all green (sessions ran from the installed copy)");
};

await main();
