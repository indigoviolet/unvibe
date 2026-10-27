#!/usr/bin/env node
/*global console process fetch setTimeout */
/**
 * Fake `pi` for the pi-runner unit tests and the j279 journey (issue #279).
 *
 * Speaks just enough of the pi CLI/RPC surface for `PiAgentRunner`:
 * - `pi --version` → `fake-pi <FAKE_PI_VERSION|0.0.0-fake>`
 * - `pi auth check --provider <p> --json` → `{"status": <ready|...>}`
 *   (status from `UNVIBE_FAKE_PI_AUTH`, default `"ready"`)
 * - `pi --mode rpc ...` → JSONL RPC: `get_state`, `prompt`, `abort`,
 *   `get_available_models`, `set_model`, `get_available_thinking_levels`,
 *   `set_thinking_level`, `get_session_stats`.
 *
 * Sessions persist as JSON under `--session-dir` (`fake-<id>.json`):
 * `--fork <file>` copies history under a new id, `--session <file>` resumes
 * it (a missing file starts a fresh id, so the runner's mismatch check can
 * fire). `UNVIBE_PI_CACHE_KEY` is recorded per session so tests can assert
 * the fork's cache-key override reached the child.
 *
 * Prompt sources (`UNVIBE_FAKE_PI_MODE`):
 * - `script` (default): `UNVIBE_FAKE_PI_SCRIPT` is a JSON array of steps:
 *   `{text, cached?}` streams text (usage splits cache reads like pi),
 *   `{call, args}` performs a real MCP `tools/call` against
 *   `UNVIBE_PI_MCP_SERVERS` and emits tool start/end, `{hang}` stalls until
 *   `abort`, `{history}` replies `history:<n>` with the message count.
 * - `replay`: `UNVIBE_FAKE_PI_FIXTURES` points at `fixtures/urllib3-5020`;
 *   prompts resolve to recording texts by the same marker/keyword rules as
 *   the replay runner (base pack → `ready`).
 *
 * Observability: `UNVIBE_FAKE_PI_LOG` appends one line per spawn
 * (`SPAWN argv=… cachekey=…`) so tests can assert flags and env reached pi.
 * Plain Node, no dependencies, no network except loopback MCP calls.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);

function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function has(name) {
  return argv.includes(name);
}

function logSpawn() {
  const log = process.env.UNVIBE_FAKE_PI_LOG;
  if (!log) return;
  try {
    fs.appendFileSync(log, `SPAWN argv=${JSON.stringify(argv)} cachekey=${process.env.UNVIBE_PI_CACHE_KEY ?? ""} mcp=${process.env.UNVIBE_PI_MCP_SERVERS ?? ""}\n`);
  } catch {
    // never fail the fake on logging
  }
}

// --- `pi --version` ---------------------------------------------------------
if (has("--version") || has("-v")) {
  console.log(`fake-pi ${process.env.UNVIBE_FAKE_PI_VERSION ?? "0.0.0-fake"}`);
  process.exit(0);
}

// --- `pi auth check` ----------------------------------------------------------
if (argv[0] === "auth" && argv[1] === "check") {
  const provider = arg("--provider") ?? "unknown";
  const status = process.env.UNVIBE_FAKE_PI_AUTH ?? "ready";
  const out = { status, provider };
  if (status !== "ready") out.reason = process.env.UNVIBE_FAKE_PI_AUTH_REASON ?? "credentials_not_configured";
  console.log(JSON.stringify(out));
  process.exit(0);
}

if (!argv.includes("--mode") || argv[argv.indexOf("--mode") + 1] !== "rpc") {
  console.error(`fake pi: unsupported invocation: ${argv.join(" ")}`);
  process.exit(2);
}

// --- RPC mode ------------------------------------------------------------------
logSpawn();

const sessionDir = arg("--session-dir") ?? path.join(os.tmpdir(), "fake-pi-sessions");
fs.mkdirSync(sessionDir, { recursive: true });
const mode = process.env.UNVIBE_FAKE_PI_MODE ?? "script";

function sessionFile(id) {
  return path.join(sessionDir, `${id}.json`);
}
function newId() {
  return `fake-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function loadSession(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function saveSession(s) {
  try {
    fs.writeFileSync(sessionFile(s.id), JSON.stringify(s));
  } catch {
    // best effort
  }
}

let session;
const forkFrom = arg("--fork");
const resumeFile = arg("--session");
if (forkFrom) {
  const base = loadSession(forkFrom);
  session = {
    id: newId(),
    messages: base ? [...base.messages] : [],
    model: arg("--model") ?? base?.model ?? "fake-model",
    thinking: base?.thinking ?? "",
    cacheKeySeen: process.env.UNVIBE_PI_CACHE_KEY ?? "",
  };
} else if (resumeFile) {
  const prev = loadSession(resumeFile);
  session = prev
    ? { ...prev, messages: [...prev.messages], cacheKeySeen: process.env.UNVIBE_PI_CACHE_KEY ?? prev.cacheKeySeen ?? "" }
    : { id: newId(), messages: [], model: arg("--model") ?? "fake-model", thinking: "", cacheKeySeen: process.env.UNVIBE_PI_CACHE_KEY ?? "" };
} else {
  session = {
    id: newId(),
    messages: [],
    model: arg("--model") ?? "fake-model",
    thinking: "",
    cacheKeySeen: process.env.UNVIBE_PI_CACHE_KEY ?? "",
  };
}
saveSession(session);

const sessionPath = sessionFile(session.id);
let streaming = false;
let aborted = false;
let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// --- prompt sources -------------------------------------------------------------
let manifest = null;
function loadManifest() {
  if (manifest) return manifest;
  manifest = { entries: [], texts: new Map() };
  const dir = process.env.UNVIBE_FAKE_PI_FIXTURES;
  if (!dir) return manifest;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    for (const e of parsed.recordings ?? []) {
      manifest.entries.push(e);
      try {
        manifest.texts.set(e.file, fs.readFileSync(path.join(dir, "recordings", e.file), "utf8"));
      } catch {
        // missing file stays unresolved
      }
    }
  } catch {
    // no manifest
  }
  return manifest;
}

const KIND_HINTS = [
  [/replay-kind:\s*([\w-]+)/i, "__explicit__"],
  [/reply with exactly\s+`?ready`?/i, "base"],
  [/\breader\b|guided review|central change/i, "reader"],
  [/\bcritic\b|agent finding/i, "critic"],
  [/concept[-_ ]page|concept:\s*[\w-]+/i, "concept-page"],
  [/\bhunk\b|summariz/i, "hunk"],
  [/go[-_ ]deeper|placeholder card|\bgenerate\b/i, "go-deeper"],
  [/\bdepth\b|simpler|\bdeeper\b/i, "depth"],
  [/examples?/i, "examples"],
  [/\bdiagram\b|\bd2\b/i, "diagram"],
  [/\bask\b|question|thread/i, "ask"],
  [/\bexplain\b/i, "explain"],
  [/second opinion/i, "second-opinion"],
];

function explicitMarker(prompt) {
  const kind = prompt.match(/replay-kind:\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
  if (!kind) return null;
  const key = prompt.match(/replay-key:\s*([^\s]+)/i)?.[1]?.toLowerCase() ?? null;
  return { kind, key };
}

function extractKey(kind, prompt) {
  const lower = prompt.toLowerCase();
  switch (kind) {
    case "hunk": {
      const m = lower.match(/\b(conn|tconn|tsock|log):(\d+)\b/);
      return m ? `${m[1]}:${m[2]}` : null;
    }
    case "go-deeper": {
      for (const k of ["flow", "design", "regex", "check"]) if (lower.includes(k)) return k;
      return null;
    }
    case "depth": {
      const card = /central/.test(lower) ? "central" : /problem/.test(lower) ? "problem" : null;
      const level = /deep/.test(lower) ? "deep" : /simpl/.test(lower) ? "simple" : null;
      return card && level ? `${card}:${level}` : (card ?? level);
    }
    case "examples":
      return /central/.test(lower) ? "central" : /problem/.test(lower) ? "problem" : null;
    case "diagram":
      return /fold/.test(lower) ? "fold" : /path|flow|socket/.test(lower) ? "path" : null;
    case "concept-page": {
      const m = lower.match(/concept-page:\s*([\w-]+)/) ?? lower.match(/concept:([\w-]+)/);
      return m ? m[1] : null;
    }
    default:
      return null;
  }
}

function resolveReplay(prompt) {
  const m = loadManifest();
  const explicit = explicitMarker(prompt);
  const find = (kind, key) => m.entries.find((e) => e.kind === kind && (key === null || e.key === key) && m.texts.has(e.file));
  if (explicit) {
    if (explicit.key === null && (explicit.kind === "explain" || explicit.kind === "ask")) {
      for (const e of m.entries) {
        if (e.kind !== explicit.kind || !e.pattern) continue;
        if (new RegExp(e.pattern, "i").test(prompt) && m.texts.has(e.file)) return m.texts.get(e.file);
      }
    }
    const hit = find(explicit.kind, explicit.key);
    if (hit) return m.texts.get(hit.file);
    return `[fake-pi placeholder: no ${explicit.kind} recording matched]`;
  }
  let kind = null;
  for (const [re, k] of KIND_HINTS) {
    if (k === "__explicit__") continue;
    if (re.test(prompt)) {
      kind = k;
      break;
    }
  }
  if (!kind) return `[fake-pi placeholder: unmatched prompt: ${prompt.trim().split("\n")[0]?.slice(0, 80) ?? ""}]`;
  if (kind === "base") return "ready";
  if (kind === "explain" || kind === "ask") {
    for (const e of m.entries) {
      if (e.kind !== kind || !e.pattern) continue;
      if (new RegExp(e.pattern, "i").test(prompt) && m.texts.has(e.file)) return m.texts.get(e.file);
    }
    return `[fake-pi placeholder: no ${kind} recording matched]`;
  }
  const key = extractKey(kind, prompt);
  const hit = m.entries.find((e) => e.kind === kind && e.key === key && m.texts.has(e.file)) ?? (key === null ? m.entries.find((e) => e.kind === kind && m.texts.has(e.file)) : undefined);
  if (hit) return m.texts.get(hit.file);
  return `[fake-pi placeholder: no ${kind} recording for key ${key}]`;
}

// --- MCP client (scripted tool calls hit the real test mount) -------------------
async function mcpCall(url, tool, args) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const post = async (method, params, sessionId) => {
    const h = { ...headers };
    if (sessionId) h["mcp-session-id"] = sessionId;
    const res = await fetch(url, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
    });
    if (!res.ok) throw new Error(`fake-pi mcp ${method} -> ${res.status}`);
    const sid = res.headers.get("mcp-session-id") ?? sessionId;
    const text = await res.text();
    if (res.status === 202 || text === "") return { sid, result: undefined };
    const msg = JSON.parse(text);
    if (msg.error) throw new Error(`fake-pi mcp ${method}: ${msg.error.message ?? msg.error.code}`);
    return { sid, result: msg.result };
  };
  const init = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-pi", version: "0" } });
  await post("notifications/initialized", undefined, init.sid);
  const called = await post("tools/call", { name: tool, arguments: args ?? {} }, init.sid);
  try {
    await fetch(url, { method: "DELETE", headers: { "mcp-session-id": init.sid } });
  } catch {
    // best effort
  }
  const blocks = called.result?.content ?? [];
  return { text: blocks.map((b) => (b && b.type === "text" ? b.text : JSON.stringify(b))).join("\n"), isError: called.result?.isError === true };
}

function mcpServers() {
  try {
    return JSON.parse(process.env.UNVIBE_PI_MCP_SERVERS ?? "[]");
  } catch {
    return [];
  }
}

// --- scripted steps ---------------------------------------------------------------
function readScript() {
  try {
    const steps = JSON.parse(process.env.UNVIBE_FAKE_PI_SCRIPT ?? "[]");
    return Array.isArray(steps) ? steps : [];
  } catch {
    return [];
  }
}
let script = readScript();
if (forkFrom || resumeFile) {
  // A fork/resume continues the loaded history: skip the steps its turns
  // already consumed so each prompt answers the next unconsumed step.
  const answered = session.messages.filter((m) => m.role === "assistant").length;
  script = script.slice(answered);
}

function chunked(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 8) out.push(text.slice(i, i + 8));
  return out.length > 0 ? out : [""];
}

async function runPrompt(message) {
  session.messages.push({ role: "user", text: message });
  saveSession(session);
  send({ type: "agent_start" });
  send({ type: "turn_start" });
  streaming = true;
  aborted = false;

  const finishUsage = (input, output, cacheRead) => {
    tokens.input += input;
    tokens.output += output;
    tokens.cacheRead += cacheRead;
    send({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "end_turn",
        usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output },
      },
    });
  };

  if (mode === "replay") {
    const reply = resolveReplay(message);
    const words = reply.length;
    send({ type: "message_start", message: { role: "assistant", content: [] } });
    for (const c of chunked(reply)) {
      if (aborted) break;
      send({ type: "message_update", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: c } });
    }
    session.messages.push({ role: "assistant", text: reply });
    saveSession(session);
    if (!aborted) finishUsage(Math.ceil((message.length + words) / 4), Math.ceil(words / 4), Math.ceil(words / 8));
  } else {
    let step = script.length > 0 ? script.shift() : { text: "ok" };
    // One turn: text (or history) ends it; tool calls continue it.
    for (;;) {
      if (aborted) break;
      if (step.text !== undefined || step.history !== undefined) {
        const reply = step.history !== undefined ? `history:${session.messages.length}` : String(step.text);
        send({ type: "message_start", message: { role: "assistant", content: [] } });
        for (const c of chunked(reply)) {
          if (aborted) break;
          send({ type: "message_update", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: c } });
        }
        session.messages.push({ role: "assistant", text: reply });
        saveSession(session);
        if (!aborted) {
          const cached = typeof step.cached === "number" ? step.cached : 0;
          finishUsage(Math.ceil((message.length + reply.length) / 4) + 50, Math.ceil(reply.length / 4) + 7, cached);
        }
        break;
      }
      if (step.call) {
        const servers = mcpServers();
        const server = servers[0];
        let text = "";
        let isError = false;
        if (!server?.url) {
          text = `fake-pi: no MCP server for tool ${step.call}`;
          isError = true;
        } else {
          try {
            const r = await mcpCall(server.url, step.call, step.args ?? {});
            text = r.text;
            isError = r.isError;
          } catch (e) {
            text = `fake-pi mcp failed: ${e.message}`;
            isError = true;
          }
        }
        send({ type: "tool_execution_start", toolCallId: "call-1", toolName: step.call, args: step.args ?? {} });        session.messages.push({ role: "tool", text: `${step.call}: ${text}` });
        saveSession(session);
        send({
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: step.call,
          args: step.args ?? {},
          result: { content: [{ type: "text", text }], details: {} },
          isError,
        });
        finishUsage(60, 10, 5);
        step = script.length > 0 ? script.shift() : null;
        if (!step || aborted) break;
        continue;
      }
      if (step.hang !== undefined) {
        send({ type: "message_start", message: { role: "assistant", content: [] } });
        send({ type: "message_update", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "partial " } });
        // Stall until abort (or stdin close).
        while (!aborted) await new Promise((r) => setTimeout(r, 50));
        break;
      }
      break;
    }
  }

  send({ type: "agent_end", messages: [], willRetry: false });
  send({ type: "agent_settled", aborted });
  streaming = false;
}

// --- command loop --------------------------------------------------------------------
process.stdin.on("end", () => process.exit(0));
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (!line) continue;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      send({ type: "response", command: "parse", success: false, error: "fake-pi: bad json" });
      continue;
    }
    void handle(cmd).catch((e) => {
      send({ type: "response", command: cmd.type ?? "unknown", success: false, error: String(e?.message ?? e), ...(cmd.id ? { id: cmd.id } : {}) });
    });
  }
});

async function handle(cmd) {
  const id = cmd.id;
  const respond = (command, data) => send({ ...(id ? { id } : {}), type: "response", command, success: true, data });
  switch (cmd.type) {
    case "get_state":
      respond("get_state", {
        model: session.model,
        thinkingLevel: session.thinking || "off",
        isStreaming: streaming,
        isCompacting: false,
        steeringMode: "one-at-a-time",
        followUpMode: "one-at-a-time",
        sessionFile: sessionPath,
        sessionId: session.id,
        autoCompactionEnabled: false,
        messageCount: session.messages.length,
        pendingMessageCount: 0,
      });
      return;
    case "prompt":
      send({ ...(id ? { id } : {}), type: "response", command: "prompt", success: true, data: { disposition: "started" } });
      await runPrompt(String(cmd.message ?? ""));
      return;
    case "abort":
      aborted = true;
      respond("abort", {});
      return;
    case "get_available_models": {
      let models = [{ provider: "openai-codex", id: "fake-model", name: "Fake Model" }];
      try {
        const parsed = JSON.parse(process.env.UNVIBE_FAKE_PI_MODELS ?? "null");
        // An explicit array (even empty) wins; unset/invalid → default.
        if (Array.isArray(parsed)) models = parsed;
      } catch {
        // default stands
      }
      respond("get_available_models", { models });
      return;
    }
    case "set_model":
      session.model = String(cmd.modelId ?? session.model);
      saveSession(session);
      respond("set_model", { id: session.model, provider: cmd.provider ?? "openai-codex", name: session.model });
      return;
    case "get_available_thinking_levels": {
      let levels = ["low", "high"];
      try {
        const parsed = JSON.parse(process.env.UNVIBE_FAKE_PI_THINKING ?? "null");
        if (Array.isArray(parsed) && parsed.length > 0) levels = parsed;
      } catch {
        // default stands
      }
      respond("get_available_thinking_levels", { levels });
      return;
    }
    case "set_thinking_level":
      session.thinking = String(cmd.level ?? "");
      saveSession(session);
      respond("set_thinking_level", {});
      return;
    case "get_session_stats":
      respond("get_session_stats", {
        sessionFile: sessionPath,
        sessionId: session.id,
        userMessages: session.messages.filter((m) => m.role === "user").length,
        assistantMessages: session.messages.filter((m) => m.role === "assistant").length,
        toolCalls: session.messages.filter((m) => m.role === "tool").length,
        toolResults: 0,
        totalMessages: session.messages.length,
        tokens: { ...tokens, total: tokens.input + tokens.output },
        cost: 0,
      });
      return;
    default:
      send({ ...(id ? { id } : {}), type: "response", command: cmd.type ?? "unknown", success: false, error: `fake-pi: unsupported command ${cmd.type}` });
  }
}
