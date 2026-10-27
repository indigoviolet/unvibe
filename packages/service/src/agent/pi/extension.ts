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
    var res = await globalThis.fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(notif
        ? { jsonrpc: "2.0", method: method, ...(params === undefined ? {} : { params: params }) }
        : { jsonrpc: "2.0", id: 1, method: method, ...(params === undefined ? {} : { params: params }) }),
    });
    if (!res.ok) throw new Error("mcp " + method + " -> " + res.status);
    var sid = res.headers.get("mcp-session-id") ?? sessionId;
    var text = await res.text();
    if (res.status === 202 || text === "") return { sid: sid, result: undefined };
    var msg = parseMcpBody(text);
    if (msg.error) throw new Error("mcp " + method + ": " + (msg.error.message ?? msg.error.code));
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
            var called = await mcp(s.url, "tools/call", { name: t.name, arguments: params ?? {} }, toolSid);
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
