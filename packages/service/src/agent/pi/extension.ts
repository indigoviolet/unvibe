/**
 * Unvibe pi extension source (issue #279, route 2: native pi runner over RPC).
 *
 * This is plain JavaScript (no TypeScript syntax, no imports beyond
 * `node:` builtins) so pi loads it directly with `-e <file>` — no install
 * script, no compiler, nothing to build. The runner writes this string to a
 * temp file once per service run and passes its path to every pi process.
 *
 * What it does, and why each part is the smallest working option
 * (verified against pi 1.4.0 offline: real pi CLI, fake ChatGPT backend on
 * loopback, stub MCP server):
 *
 * 1. Review tools reach the agent. RPC has no command to register Unvibe's
 *    per-session MCP servers, and pi's built-in MCP (`mcp.json`,
 *    `registerMcpServer`) would name them `mcp__<server>__<tool>` while
 *    Unvibe's prompts call the bare names (`get_hunk`, …), and would also
 *    connect the user's own `mcp.json` servers (blocked with `--no-mcp`).
 *    So the extension bridges each `UNVIBE_PI_MCP_SERVERS` entry itself
 *    with `fetch` (MCP streamable HTTP: initialize → tools/list →
 *    tools/call, loopback only) and registers every offered tool under its
 *    bare name as a `direct` tool. The runner names the same tools in
 *    `--tools`, because a `--tools` allowlist filters out late-registered
 *    extension tools otherwise.
 * 2. Forks reuse the base's prompt-cache key. pi sets `prompt_cache_key`
 *    to the session id, so a fork (`--fork`, new session id) would miss
 *    the base's cache (measured 0% cached vs 91% shared in the spike).
 *    When `UNVIBE_PI_CACHE_KEY` is set (forks only), the
 *    `before_provider_request` hook rewrites the key on the outgoing
 *    provider payload. Verified: the fork's request carries the base's
 *    key while its session id stays its own.
 * 3. Read-only by construction. In the default posture
 *    (`UNVIBE_PI_READONLY=1`, issue #160) the extension replaces pi's
 *    built-in `read` and `ls` (same names take over) with versions that
 *    resolve symlinks and refuse anything outside `UNVIBE_PI_CWD`, and
 *    the runner passes `--tools read,ls,…` with no shell/edit/write.
 *    The MCP bridge marks its tools `readOnlyHint`. Full access
 *    (`UNVIBE_PI_READONLY=0`) skips the replacements: pi's own tools
 *    stand, and the runner passes the wider `--tools` list. See
 *    `pi-runner.ts` for what full access means on this route.
 *
 * Environment (set by the runner per pi process):
 * - `UNVIBE_PI_MCP_SERVERS`: JSON `[{name, url}]` of this session's MCP
 *   mount (per-session secret URLs on the service's loopback mount).
 * - `UNVIBE_PI_CACHE_KEY`: prompt-cache key to stamp on every provider
 *   request (a fork's base session id). Absent on base sessions.
 * - `UNVIBE_PI_READONLY`: `"1"` (default) or `"0"` (full access, #160).
 * - `UNVIBE_PI_CWD`: the review worktree the file tools are bound to.
 */
export const PI_EXTENSION_SOURCE = `/**
 * Unvibe pi extension (generated; see packages/service/src/agent/pi/extension.ts).
 * Plain JS, node: builtins only. Loaded by pi with -e (jiti not needed).
 */
import fs from "node:fs";
import path from "node:path";

export default async function (pi) {
  var servers = JSON.parse(process.env.UNVIBE_PI_MCP_SERVERS ?? "[]");
  var cacheKey = process.env.UNVIBE_PI_CACHE_KEY ?? "";
  var readOnly = process.env.UNVIBE_PI_READONLY !== "0";
  var root = process.env.UNVIBE_PI_CWD ?? process.cwd();
  // Diagnosis log (issue #348): when UNVIBE_PI_TOOL_LOG names a file, every
  // MCP bridge call appends one JSON line (tool, start, end, result size,
  // error). Off unless set; never read back, only appended.
  var toolLog = process.env.UNVIBE_PI_TOOL_LOG ?? "";
  function logTool(rec) {
    if (!toolLog) return;
    try {
      rec.at = new Date().toISOString();
      fs.appendFileSync(toolLog, JSON.stringify(rec) + String.fromCharCode(10));
    } catch (e) {}
  }
  // Per-tool-call timeout, ms (issue #348): a stuck MCP call used to hang
  // the whole turn until pi's own 10-minute timeout. Now the call fails and
  // the model gets a tool error it can react to (narrower range, skip).
  // Loopback + local git/disk answers in ms (measured ~15-30ms even with a
  // dozen concurrent calls), so 60s is generous headroom, not a limit on
  // legitimate work. Override with UNVIBE_PI_TOOL_TIMEOUT_MS.
  var toolTimeoutMs = Number(process.env.UNVIBE_PI_TOOL_TIMEOUT_MS ?? "60000");
  if (!isFinite(toolTimeoutMs) || toolTimeoutMs <= 0) toolTimeoutMs = 60000;

  if (cacheKey) {
    pi.on("before_provider_request", function (event) {
      var p = event.payload;
      if (p && typeof p === "object" && "prompt_cache_key" in p) {
        var next = {};
        for (var k in p) next[k] = p[k];
        next.prompt_cache_key = cacheKey;
        return next;
      }
      return undefined;
    });
  }

  function inside(p) {
    var realRoot = fs.realpathSync(root);
    var abs = path.isAbsolute(p) ? p : path.join(root, p);
    var real;
    try {
      real = fs.realpathSync(abs);
    } catch (e) {
      // Missing file: resolve lexically; it must still stay inside root.
      real = path.resolve(abs);
    }
    if (real !== realRoot && real.indexOf(realRoot + path.sep) !== 0) {
      throw new Error("path is outside the review worktree: " + p);
    }
    return real;
  }

  if (readOnly) {
    pi.registerTool({
      name: "read",
      label: "read",
      description: "Read a text file inside the review worktree. Paths must stay inside the worktree (symlink escapes and absolute paths outside are refused).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repo-relative file path." },
          offset: { type: "number", description: "Line number to start reading from (1-indexed)." },
          limit: { type: "number", description: "Maximum number of lines to read." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async function (_toolCallId, params) {
        var real;
        try {
          real = inside(String((params && params.path) ?? ""));
        } catch (e) {
          return { content: [{ type: "text", text: "error: " + e.message }], details: undefined, isError: true };
        }
        var text;
        try {
          text = fs.readFileSync(real, "utf8");
        } catch (e) {
          return { content: [{ type: "text", text: "error: " + e.message }], details: undefined, isError: true };
        }
        var lines = text.split("\\n");
        var offset = Math.max(1, Number((params && params.offset) ?? 1) || 1);
        var limit = Number(params && params.limit);
        var slice = lines.slice(offset - 1, isFinite(limit) ? offset - 1 + limit : undefined);
        var out = slice.join("\\n");
        if (lines.length > 2000 || out.length > 50 * 1024) {
          out = slice.slice(0, 2000).join("\\n").slice(0, 50 * 1024) + "\\n[truncated: use offset/limit to read more]";
        }
        return { content: [{ type: "text", text: out }], details: undefined };
      },
    });
    pi.registerTool({
      name: "ls",
      label: "ls",
      description: "List directory contents inside the review worktree.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to list (default: worktree root)." },
          limit: { type: "number", description: "Maximum number of entries (default 500)." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async function (_toolCallId, params) {
        var real;
        try {
          real = inside(String((params && params.path) ?? "."));
        } catch (e) {
          return { content: [{ type: "text", text: "error: " + e.message }], details: undefined, isError: true };
        }
        var entries;
        try {
          entries = fs.readdirSync(real, { withFileTypes: true });
        } catch (e) {
          return { content: [{ type: "text", text: "error: " + e.message }], details: undefined, isError: true };
        }
        var limit = Number((params && params.limit) ?? 500) || 500;
        var names = entries
          .map(function (e) {
            return e.isDirectory() ? e.name + "/" : e.name;
          })
          .sort()
          .slice(0, limit);
        return { content: [{ type: "text", text: names.join("\\n") }], details: undefined };
      },
    });
  }

  var LF = String.fromCharCode(10);
  function isWs(c) { return c === 32 || c === 9 || c === 13 || c === 10; }
  function trimWs(s) {
    var a = 0;
    var b = s.length - 1;
    while (a <= b && isWs(s.charCodeAt(a))) a++;
    while (b >= a && isWs(s.charCodeAt(b))) b--;
    return a <= b ? s.slice(a, b + 1) : "";
  }
  function parseMcpBody(text) {
    // The service's streamable-HTTP mount answers POST with SSE
    // (event: message / data: {...} lines); plain JSON is also accepted.
    var i = 0;
    while (i < text.length && isWs(text.charCodeAt(i))) i++;
    var first = text.charAt(i);
    if (first === "{" || first === "[") return JSON.parse(text);
    var last;
    var lines = text.split(LF);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var payload;
      if (line.slice(0, 5) === "data:") {
        payload = line.slice(5);
        var k = 0;
        while (k < payload.length && (payload.charCodeAt(k) === 32 || payload.charCodeAt(k) === 9)) k++;
        payload = payload.slice(k);
      } else {
        var t = trimWs(line);
        if (t === "" || t.slice(0, 6) === "event:" || t.slice(0, 3) === "id:") continue;
        payload = t;
      }
      if (payload === "" || payload === "[DONE]") continue;
      try {
        last = JSON.parse(payload);
      } catch (e) {
        // keep scanning: a later data: line carries the message
      }
    }
    if (last === undefined) return JSON.parse(text);
    return last;
  }

  async function mcp(url, method, params, sessionId) {
    var headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    // JSON-RPC notifications carry no id; the mount answers 202 with no body.
    var notif = method.slice(0, 14) === "notifications/";
    var toolName = method === "tools/call" && params && typeof params.name === "string" ? params.name : method;
    var start = Date.now();
    // The fetch AND the body read share one deadline: a server that answers
    // headers but never closes its SSE stream must not hang the tool.
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) {
        try { ctrl.abort(); } catch (e2) {}
      }
    }, toolTimeoutMs);
    function bridgeTimeout() { return !!ctrl && ctrl.signal.aborted; }
    function timeoutError() { return "mcp " + method + " timed out after " + toolTimeoutMs + "ms"; }
    var res;
    try {
      var reqInit = {
        method: "POST",
        headers: headers,
        body: JSON.stringify(notif
          ? { jsonrpc: "2.0", method: method, ...(params === undefined ? {} : { params: params }) }
          : { jsonrpc: "2.0", id: 1, method: method, ...(params === undefined ? {} : { params: params }) }),
      };
      if (ctrl) reqInit.signal = ctrl.signal;
      res = await globalThis.fetch(url, reqInit);
    } catch (e) {
      clearTimeout(timer);
      if (bridgeTimeout()) {
        logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: timeoutError(), timeoutMs: toolTimeoutMs });
        throw new Error(timeoutError());
      }
      logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: String((e && e.message) || e).slice(0, 500) });
      throw e;
    }
    if (!res.ok) {
      clearTimeout(timer);
      logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: "mcp " + method + " -> " + res.status });
      throw new Error("mcp " + method + " -> " + res.status);
    }
    var sid = res.headers.get("mcp-session-id") ?? sessionId;
    var text;
    try {
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (bridgeTimeout()) {
        logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: timeoutError(), timeoutMs: toolTimeoutMs });
        throw new Error(timeoutError());
      }
      logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: String((e && e.message) || e).slice(0, 500) });
      throw e;
    }
    clearTimeout(timer);
    if (res.status === 202 || text === "") {
      logTool({ tool: toolName, start: start, end: Date.now(), ok: true, size: 0 });
      return { sid: sid, result: undefined };
    }
    var msg = parseMcpBody(text);
    if (msg.error) {
      logTool({ tool: toolName, start: start, end: Date.now(), ok: false, error: String("mcp " + method + ": " + (msg.error.message ?? msg.error.code)).slice(0, 500), size: text.length });
      throw new Error("mcp " + method + ": " + (msg.error.message ?? msg.error.code));
    }
    logTool({ tool: toolName, start: start, end: Date.now(), ok: true, size: text.length });
    return { sid: sid, result: msg.result };
  }

  for (var si = 0; si < servers.length; si++) {
    var s = servers[si];
    var init = await mcp(s.url, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unvibe-pi", version: "0.0.0" },
    });
    var sid = init.sid;
    await mcp(s.url, "notifications/initialized", undefined, sid);
    var listed = await mcp(s.url, "tools/list", {}, sid);
    var tools = (listed.result && listed.result.tools) || [];
    for (var ti = 0; ti < tools.length; ti++) {
      (function (t) {
        var schema = t.inputSchema ?? {};
        var toolSid = listed.sid ?? sid;
        pi.registerTool({
          name: t.name,
          label: t.name,
          description: t.description ?? t.name,
          parameters: {
            type: "object",
            properties: schema.properties ?? {},
            ...(schema.required ? { required: schema.required } : {}),
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: async function (_toolCallId, params) {
            // Never reject (issue #348): a rejected tool promise left pi
            // with no tool_execution_end and the turn went silent until the
            // 10-minute timeout. Every failure comes back as a tool error
            // the model can react to, like the read/ls replacements above.
            try {
              var called = await mcp(s.url, "tools/call", { name: t.name, arguments: params ?? {} }, toolSid);
            } catch (e) {
              var emsg = String((e && e.message) || e).slice(0, 500);
              return { content: [{ type: "text", text: "error: " + emsg }], details: undefined, isError: true };
            }
            var blocks = (called.result && called.result.content) || [];
            var content = [];
            for (var bi = 0; bi < blocks.length; bi++) {
              var b = blocks[bi];
              if (b && b.type === "text" && typeof b.text === "string") content.push({ type: "text", text: b.text });
              else content.push({ type: "text", text: JSON.stringify(b) });
            }
            var isError = called.result && called.result.isError === true;
            return { content: content, details: undefined, ...(isError ? { isError: true } : {}) };
          },
        });
      })(tools[ti]);
    }
  }
}
`;
