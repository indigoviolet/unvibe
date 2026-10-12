/**
 * MCP tests (PRD §10) through a real SDK client over HTTP: tool surface
 * per role, all five tools, traversal refusal, and byte-stability.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { McpRegistry, readCodeSlice, type IssuedSession } from "../src/mcp/index.js";
import { stableToolSpec } from "../src/mcp/index.js";
import type { McpReviewData } from "../src/mcp/index.js";
import { createApp } from "../src/server.js";

const REVIEW: McpReviewData = {
  reviewId: "r1",
  headSha: "abc123",
  hunks: [
    {
      fileKey: "conn",
      path: "src/conn.py",
      contentHash: "9f2c",
      header: "@@ -140,7 +147,7 @@",
      newStart: 147,
      newEnd: 149,
      text: " context foo\n-old line\n+new line",
    },
  ],
  cards: [{ id: "c-central", title: "Central change", text: "retries with backoff in src/conn.py" }],
  annotations: [{ id: "a1", type: "thread", anchorSummary: "src/conn.py:148", text: "why backoff?" }],
  contributions: [{ id: "k1", sourceSession: "s1", text: "fact: backoff is exponential" }],
  description: [{ id: "d1", text: "this PR adds backoff" }],
};

function makeRegistry(pins: unknown[] = []): { registry: McpRegistry; commands: FakeCommandRunner } {
  const commands = new FakeCommandRunner();
  const registry = new McpRegistry({
    reader: {
      getReview: async (id) => (id === "r1" ? REVIEW : null),
      getWorktreePath: () => "/repo",
    },
    commands,
    onPin: (pin) => pins.push(pin),
  });
  return { registry, commands };
}

interface LiveServer {
  base: string;
  close: () => Promise<void>;
}

const live: LiveServer[] = [];

afterEach(async () => {
  while (live.length > 0) await live.pop()!.close();
});

async function serve(registry: McpRegistry): Promise<string> {
  const { app } = await createApp("test-token", { mcp: registry });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${addr.port}`;
  live.push({ base, close: () => app.close() });
  return base;
}

async function connect(base: string, issued: IssuedSession): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + issued.path)));
  return client;
}

function textOf(result: unknown): string {
  const r = result as { content: { type: string; text: string }[]; isError?: boolean };
  return r.content.map((c) => c.text).join("\n");
}

function isErr(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe("tool surface", () => {
  it("is byte-stable (part of the cached L0 prefix)", () => {
    expect(stableToolSpec()).toMatchSnapshot();
  });

  it("reader gets 5 tools, other sessions get 4 (no pin_context)", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const reader = await connect(base, registry.issueSession("r1", "sess-reader", "reader"));
    try {
      const tools = await reader.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual([
        "get_hunk",
        "get_code",
        "search_review",
        "resolve",
        "pin_context",
      ]);
    } finally {
      await reader.close();
    }
    const other = await connect(base, registry.issueSession("r1", "sess-7", "session"));
    try {
      const tools = await other.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual([
        "get_hunk",
        "get_code",
        "search_review",
        "resolve",
      ]);
    } finally {
      await other.close();
    }
  });

  it("pin_context from a non-reader is refused", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "sess-7", "session"));
    try {
      const res = await client.callTool({
        name: "pin_context",
        arguments: { path: "src/conn.py", lines: "1-2", why: "x" },
      });
      expect(isErr(res)).toBe(true);
      expect(textOf(res)).toMatch(/reader session/);
    } finally {
      await client.close();
    }
  });
});

describe("tools", () => {
  it("get_hunk returns text with IDs on every line", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "s", "session"));
    try {
      const res = await client.callTool({ name: "get_hunk", arguments: { id: "h:conn:9f2c" } });
      expect(isErr(res)).toBe(false);
      const text = textOf(res);
      expect(text).toContain("h:conn:9f2c");
      expect(text).toContain("147:  context foo");
      const bad = await client.callTool({ name: "get_hunk", arguments: { id: "h:nope:zzz" } });
      expect(isErr(bad)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("get_code reads via git show and refuses traversal", async () => {
    const { registry, commands } = makeRegistry();
    commands.enqueue({
      cmd: "git",
      args: ["show", "abc123:src/conn.py"],
      stdout: "l1\nl2\nl3\n",
      stderr: "",
      code: 0,
    });
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "s", "session"));
    try {
      const res = await client.callTool({
        name: "get_code",
        arguments: { path: "src/conn.py", lines: "1-2" },
      });
      expect(isErr(res)).toBe(false);
      expect(textOf(res)).toContain("code:src/conn.py:1-2@abc123");
      expect(commands.calls[0].opts.cwd).toBe("/repo");

      for (const evil of ["../evil.py", "/abs.py", "a/../../evil.py"]) {
        const refused = await client.callTool({
          name: "get_code",
          arguments: { path: evil, lines: "1" },
        });
        expect(isErr(refused), evil).toBe(true);
        expect(textOf(refused)).toMatch(/escapes repository/);
      }
      // Traversal attempts never reach git.
      expect(commands.calls).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("search_review finds cards/annotations/contributions with IDs", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "s", "session"));
    try {
      const res = await client.callTool({ name: "search_review", arguments: { query: "backoff" } });
      const text = textOf(res);
      expect(text).toContain("card:c-central");
      expect(text).toContain("ann:a1");
      const none = await client.callTool({ name: "search_review", arguments: { query: "zzz-nope" } });
      expect(textOf(none)).toBe("no matches");
    } finally {
      await client.close();
    }
  });

  it("resolve returns candidate IDs", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "s", "session"));
    try {
      const res = await client.callTool({
        name: "resolve",
        arguments: { description: "the change in src/conn.py around line 148" },
      });
      expect(textOf(res)).toContain("h:conn:9f2c");
      const none = await client.callTool({
        name: "resolve",
        arguments: { description: "quux xyzzy nothing" },
      });
      expect(textOf(none)).toBe("no candidates");
    } finally {
      await client.close();
    }
  });

  it("pin_context records the pin with attribution", async () => {
    const pins: unknown[] = [];
    const { registry } = makeRegistry(pins);
    const base = await serve(registry);
    const client = await connect(base, registry.issueSession("r1", "sess-reader", "reader"));
    try {
      const res = await client.callTool({
        name: "pin_context",
        arguments: { path: "src/conn.py", lines: "147-149", why: "core loop" },
      });
      expect(isErr(res)).toBe(false);
      expect(pins).toHaveLength(1);
      expect(pins[0]).toMatchObject({
        reviewId: "r1",
        sessionId: "sess-reader",
        path: "src/conn.py",
        lines: "147-149",
        why: "core loop",
      });
      expect(registry.listPins("r1")).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("readCodeSlice resolves raw slices and reports failures without throwing", async () => {
    const commands = new FakeCommandRunner();
    commands.enqueue({ cmd: "git", args: ["show", "abc:a.py"], stdout: "l1\nl2\nl3\n", stderr: "", code: 0 });
    expect(await readCodeSlice(commands, "/repo", "abc", "a.py", 1, 2)).toEqual({ text: "l1\nl2" });
    commands.enqueue({ cmd: "git", args: ["show", "abc:missing.py"], stdout: "", stderr: "fatal", code: 128 });
    expect(await readCodeSlice(commands, "/repo", "abc", "missing.py", 1, 1)).toEqual({ error: "not-found" });
    commands.enqueue({ cmd: "git", args: ["show", "abc:a.py"], stdout: "l1\nl2\n", stderr: "", code: 0 });
    expect(await readCodeSlice(commands, "/repo", "abc", "a.py", 1, 9)).toEqual({ error: "out-of-range" });
    commands.enqueue({ cmd: "git", args: ["show", "abc:bin"], stdout: "a\0b", stderr: "", code: 0 });
    expect(await readCodeSlice(commands, "/repo", "abc", "bin", 1, 1)).toEqual({ error: "binary" });
    // An unexpected command (runner throws) also resolves to not-found.
    expect(await readCodeSlice(commands, "/repo", "abc", "other.py", 1, 1)).toEqual({ error: "not-found" });
    expect(commands.calls).toHaveLength(5);
  });
});

describe("endpoint protection", () => {
  it("needs no install token (secret is the credential) but 404s unknown secrets", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const noToken = await fetch(base + "/api/mcp/nope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(noToken.status).toBe(404);
    // …while every other /api/* route still demands the token.
    const gated = await fetch(base + "/api/jobs?review=r1");
    expect(gated.status).toBe(401);
  });
});

describe("secret lifecycle", () => {
  it("secrets are unguessable 256-bit values scoped to one review", async () => {
    const { registry } = makeRegistry();
    const a = registry.issueSession("r1", "s-a", "session");
    const b = registry.issueSession("r1", "s-b", "session");
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(b.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(registry.liveSecretCount("r1")).toBe(2);
    // A secret for another review cannot read this one: the registry
    // scopes every tool call to the secret's own review.
    const other = registry.issueSession("r2", "s-c", "session");
    expect(registry.liveSecretCount("r1")).toBe(2);
    expect(registry.liveSecretCount("r2")).toBe(1);
    expect(registry.hasSession(other.secret)).toBe(true);
    expect(registry.hasSession("0".repeat(64))).toBe(false);
  });

  it("revoked secrets stop working; revokeForReview kills a review's secrets", async () => {
    const { registry } = makeRegistry();
    const base = await serve(registry);
    const issued = registry.issueSession("r1", "s-rev", "session");
    const client = await connect(base, issued);
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
    registry.revokeSession(issued.secret);
    expect(registry.hasSession(issued.secret)).toBe(false);
    const dead = await fetch(base + issued.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(dead.status).toBe(404);

    const s1 = registry.issueSession("r1", "s-1", "session");
    const s2 = registry.issueSession("r1", "s-2", "reader");
    const s3 = registry.issueSession("r9", "s-3", "session");
    expect(registry.revokeForReview("r1")).toBe(2);
    expect(registry.hasSession(s1.secret)).toBe(false);
    expect(registry.hasSession(s2.secret)).toBe(false);
    expect(registry.hasSession(s3.secret)).toBe(true);
    expect(registry.liveSecretCount("r1")).toBe(0);
    expect(registry.revokeForReview("r1")).toBe(0);
  });

  it("revokeBySessionId drops superseded session labels", () => {
    const { registry } = makeRegistry();
    registry.issueSession("r1", "base-r1", "session");
    registry.issueSession("r1", "base-r1", "session");
    const other = registry.issueSession("r1", "reader-r1", "reader");
    expect(registry.revokeBySessionId("base-r1")).toBe(2);
    expect(registry.liveSecretCount("r1")).toBe(1);
    expect(registry.hasSession(other.secret)).toBe(true);
  });
});
