#!/usr/bin/env node
// Spike driver (issue #104): one ACP adapter, one provider, one scenario.
//
// It is its own small ACP client on purpose: the product runner locks the
// agent down (read-only tools, deny-by-default permissions), and the spike
// needs to choose the session mode and how permission requests are answered.
// Nothing here is product code.
//
//   node acp-drive.mjs --provider claude|codex --scenario functional|actions|injection|hold
//        --mode <session mode id> [--nono] [--model <id>] [--perm allow|deny|hold:<sec>]
//        --out <result.json>
//
// Reads the scratch layout from SPIKE_DIR (see README): a scratch HOME with a
// copy of the agent login, the fixture checkout, stub or real gh on PATH.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const provider = arg("provider");
const scenario = arg("scenario");
const mode = arg("mode");
const useNono = arg("nono", false) === true;
const model = arg("model", "");
const perm = String(arg("perm", "deny"));
const outFile = arg("out");
const SPIKE = process.env.SPIKE_DIR;
if (!provider || !scenario || !outFile || !SPIKE) {
  console.error("usage: SPIKE_DIR=<scratch> acp-drive.mjs --provider … --scenario … --mode … [--nono] --out file");
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(join(SPIKE, "spike-config.json"), "utf8"));
const checkout = join(SPIKE, "fx", "checkout");
const home = join(SPIKE, "home2");
const t0 = Date.now();
const ms = () => Date.now() - t0;
const result = { provider, scenario, mode, nono: useNono, model, perm, steps: [], permissionRequests: [], mcpCalls: [], stderrTail: "" };
const step = (name, data) => {
  result.steps.push({ at: ms(), name, ...data });
  console.error(`[${ms()}ms] ${name} ${data ? JSON.stringify(data).slice(0, 300) : ""}`);
};

// ---- a stand-in for Unvibe's review MCP server on 127.0.0.1 ----
async function startMcp() {
  const server = new McpServer({ name: "unvibe-spike", version: "0.0.0" });
  server.tool("get_note", "Return the text of a review note by id (spike stub).", { id: z.string() }, async ({ id }) => {
    result.mcpCalls.push({ at: ms(), id });
    return { content: [{ type: "text", text: `NOTE:${id}:quiet-harbor-58` }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);
  const http = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (parsed?.method === "server/discover") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, error: { code: -32601, message: "Method not found" } }),
        );
        return;
      }
      transport.handleRequest(req, res, parsed).catch((e) => {
        if (!res.headersSent) res.writeHead(500).end(String(e));
      });
    });
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  return { port: http.address().port, close: () => new Promise((r) => http.close(() => r())) };
}

// The checked-in profile is the policy; the machine-specific part (where the
// agent CLI and its helper programs live) is added here, the way the service
// would when it writes the profile into its data dir at start-up. With command
// policies on, nono only lets the sandbox execute programs from system paths
// and from `command_policies.executable_dirs`.
function machineProfile() {
  const p = JSON.parse(readFileSync(join(here, "..", "policy", `unvibe-${provider}.json`), "utf8"));
  const roots = provider === "claude" ? [dirname(cfg.realClaude)] : [dirname(dirname(cfg.realCodex))];
  // Claude Code is one binary and needs no entry here. (nono refuses a
  // group-writable directory in this list, which a mise install dir is.)
  const dirs = provider === "claude" ? [] : [dirname(cfg.realCodex), join(dirname(dirname(cfg.realCodex)), "codex-path")];
  p.filesystem.read = [...(p.filesystem.read ?? []), ...roots];
  p.command_policies.executable_dirs = dirs.filter((d) => existsSync(d));
  const out = join(SPIKE, "profiles", `unvibe-${provider}.gen.json`);
  writeFileSync(out, JSON.stringify(p, null, 2));
  return out;
}

// ---- adapter subprocess with a clean environment ----
const mcp = await startMcp();
const real = provider === "claude" ? cfg.realClaude : cfg.realCodex;
const wrapper = join(here, "agent-wrapper.sh");
const adapterVar = provider === "claude" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH";
const ghDir = useNono ? cfg.realGhDir : join(SPIKE, "stub-bin"); // without nono, `gh` is a stub that only logs
const env = {
  HOME: home,
  PATH: [join(SPIKE, "bin"), ghDir, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
  TMPDIR: cfg.shortTmp, // short: nono binds a unix socket under TMPDIR (108-byte path limit)
  TERM: "dumb",
  LANG: "C.UTF-8",
  NO_BROWSER: "1",
  SPIKE_GH_STUB_LOG: join(SPIKE, "fx", "gh-stub.log"),
  [adapterVar]: useNono ? wrapper : real,
  ...(useNono
    ? {
        UNVIBE_NONO_BIN: join(SPIKE, "bin", "nono"),
        UNVIBE_NONO_PROFILE: machineProfile(),
        UNVIBE_REAL_AGENT: real,
        UNVIBE_AGENT_SCRATCH: cfg.shortTmp,
        UNVIBE_MCP_PORT: String(mcp.port),
        UNVIBE_GH_TOKEN: cfg.fakeGhToken,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_STATE_HOME: join(home, ".local", "state"),
      }
    : {}),
};
const entry = require.resolve(`@agentclientprotocol/${provider === "claude" ? "claude-agent-acp" : "codex-acp"}/dist/index.js`);
const proc = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"], env, cwd: checkout });
proc.stderr.on("data", (d) => {
  result.stderrTail = (result.stderrTail + d.toString()).slice(-3000);
});
step("adapter spawned", { pid: proc.pid });

const updates = new Map(); // sessionId -> update[]
const holdSec = perm.startsWith("hold:") ? Number(perm.slice(5)) : 0;
const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout));
const conn = acp
  .client({ name: "unvibe-spike" })
  .onRequest("session/request_permission", async (ctx) => {
    const p = ctx.params;
    const rec = {
      at: ms(),
      title: p.toolCall?.title ?? "",
      kind: p.toolCall?.kind ?? "",
      rawInput: JSON.stringify(p.toolCall?.rawInput ?? null).slice(0, 400),
      options: (p.options ?? []).map((o) => o.kind),
      answer: "",
    };
    result.permissionRequests.push(rec);
    const pick = (re) => (p.options ?? []).find((o) => re.test(o.kind));
    const isMcp = /unvibe|get_note/i.test(rec.title) || p._meta?.is_mcp_tool_approval === true;
    let opt;
    if (isMcp) opt = pick(/^allow_once$/) ?? pick(/^allow/);
    else if (perm === "allow") opt = pick(/^allow_once$/) ?? pick(/^allow/);
    else if (holdSec > 0) {
      // (a): hold the request open, then answer, as a UI dialog would.
      await new Promise((r) => setTimeout(r, holdSec * 1000));
      opt = pick(/^allow_once$/) ?? pick(/^allow/);
      rec.heldMs = ms() - rec.at;
    } else opt = pick(/reject|deny/);
    rec.answer = opt ? opt.kind : "cancelled";
    console.error(`[${ms()}ms] permission ${rec.title.slice(0, 80)} -> ${rec.answer}`);
    return { outcome: opt ? { outcome: "selected", optionId: opt.optionId } : { outcome: "cancelled" } };
  })
  .onNotification("session/update", async (ctx) => {
    const { sessionId, update } = ctx.params;
    if (!updates.has(sessionId)) updates.set(sessionId, []);
    updates.get(sessionId).push({ at: ms(), ...update });
  })
  .onRequest("fs/write_text_file", async () => {
    throw new acp.RequestError(-32603, "denied");
  })
  .onRequest("fs/read_text_file", async () => {
    throw new acp.RequestError(-32603, "denied");
  })
  .onRequest("terminal/create", async () => {
    throw new acp.RequestError(-32603, "denied");
  })
  .connect(stream);
const rpc = (m, p) => conn.agent.request(m, p);

const systemPrompt = readFileSync(join(here, "..", "fixtures", String(arg("system", "system-prompt.md"))), "utf8");
const mcpServers = [{ type: "http", name: "unvibe", url: `http://127.0.0.1:${mcp.port}/mcp`, headers: [] }];
const meta = provider === "claude" ? { systemPrompt } : { jetbrains: { air: { version: 1, customInstructions: systemPrompt } } };

async function prompt(sessionId, text, label) {
  const from = (updates.get(sessionId) ?? []).length;
  const start = ms();
  let res, err;
  try {
    res = await rpc("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
  } catch (e) {
    err = String(e?.message ?? e) + " " + JSON.stringify(e?.data ?? "");
  }
  await new Promise((r) => setTimeout(r, 300));
  const ups = (updates.get(sessionId) ?? []).slice(from);
  const chunks = ups.filter((u) => u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text");
  const tools = new Map();
  for (const u of ups) {
    if (u.sessionUpdate !== "tool_call" && u.sessionUpdate !== "tool_call_update") continue;
    const t = tools.get(u.toolCallId) ?? {};
    if (u.title) t.title = u.title;
    if (u.status) t.status = u.status;
    if (u.rawInput) t.input = JSON.stringify(u.rawInput).slice(0, 500);
    const out = u.rawOutput ?? u.content;
    if (out) t.output = JSON.stringify(out).slice(0, 1500);
    tools.set(u.toolCallId, t);
  }
  const data = {
    label,
    ms: ms() - start,
    firstTextMs: chunks.length ? chunks[0].at - start : null,
    textChunks: chunks.length,
    text: chunks.map((c) => c.content.text).join(""),
    tools: [...tools.values()],
    stopReason: res?.stopReason,
    usage: res?.usage ?? null,
    quota: res?._meta?.quota ?? null,
    error: err,
  };
  step(`prompt ${label}`, data);
  return data;
}

async function newSession() {
  const s = ms();
  const r = await rpc("session/new", { cwd: checkout, mcpServers, _meta: meta });
  step("session/new", { ms: ms() - s, modes: r.modes?.availableModes?.map((m) => m.id), current: r.modes?.currentModeId });
  if (model) {
    const s2 = ms();
    await rpc("session/set_config_option", { sessionId: r.sessionId, configId: "model", value: model });
    step("set model", { ms: ms() - s2, model });
  }
  if (mode) {
    const s3 = ms();
    try {
      await rpc("session/set_mode", { sessionId: r.sessionId, modeId: mode });
      step("set mode", { ms: ms() - s3, mode });
    } catch (e) {
      step("set mode FAILED", { mode, error: String(e?.message ?? e) });
    }
  }
  return r.sessionId;
}

const fixture = (f) => readFileSync(join(here, "..", "fixtures", f), "utf8").replaceAll("@HOME@", home).replaceAll("@OUTSIDE@", join(SPIKE, "fx", "outside"));

try {
  const s = ms();
  const init = await rpc("initialize", { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  step("initialize", { ms: ms() - s, agent: init.agentInfo ?? null });
  const sid = await newSession();

  if (scenario === "functional") {
    await prompt(sid, "Call the unvibe MCP tool get_note with id \"alpha\" and reply with exactly the text it returns, nothing else.", "mcp");
    const s1 = ms();
    const f = await rpc("session/fork", { sessionId: sid, cwd: checkout });
    step("session/fork", { ms: ms() - s1 });
    if (provider === "claude") {
      const s2 = ms();
      await rpc("session/resume", { sessionId: f.sessionId, cwd: checkout, mcpServers, _meta: meta });
      step("session/resume (fork)", { ms: ms() - s2 });
    }
    if (mode) await rpc("session/set_mode", { sessionId: f.sessionId, modeId: mode }).catch(() => {});
    await prompt(f.sessionId, "Without calling any tool: what text did the note tool return earlier? Reply with that text only.", "fork recall");
    await rpc("session/close", { sessionId: sid }).catch((e) => step("close error", { error: String(e?.message ?? e) }));
    const s3 = ms();
    await rpc("session/load", { sessionId: sid, cwd: checkout, mcpServers, _meta: meta });
    step("session/load", { ms: ms() - s3 });
    await new Promise((r) => setTimeout(r, 300));
    if (mode) await rpc("session/set_mode", { sessionId: sid, modeId: mode }).catch(() => {});
    await prompt(sid, "Without calling any tool: reply with the note text again, nothing else.", "after load");
  } else if (scenario === "actions") {
    await prompt(sid, fixture("actions-prompt.md"), "actions");
  } else if (scenario === "injection") {
    await prompt(sid, fixture("injection-prompt.md"), "injection");
  } else if (scenario === "grep") {
    await prompt(sid, "Use your built-in file search tool (Grep, not the shell) to find the text \"def sub\" in the current directory, then reply with the file name and line number only. If the tool fails, reply with its exact error.", "grep");
  } else if (scenario === "hold") {
    // An action each CLI asks about in its asking mode (default / workspace-write).
    const ask =
      provider === "claude"
        ? 'Run this shell command and reply with its output only: gh pr comment 7 -R acme/app --body "spike hold test"'
        : `With your file editing tool (not the shell), append the line "# spike hold test" to ${join(SPIKE, "fx", "outside", "note.txt")} and reply "done" or the exact error.`;
    await prompt(sid, ask, "hold");
  }
  result.ok = true;
} catch (e) {
  result.ok = false;
  result.error = String(e?.stack ?? e);
  console.error(result.error);
} finally {
  const stub = join(SPIKE, "fx", "gh-stub.log");
  result.ghStubLog = existsSync(stub) ? readFileSync(stub, "utf8") : "";
  result.totalMs = ms();
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  try {
    conn.close?.();
  } catch {
    // ignore
  }
  proc.kill();
  await mcp.close().catch(() => {});
  setTimeout(() => process.exit(0), 500).unref();
}
