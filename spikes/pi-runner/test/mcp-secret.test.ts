/**
 * Side finding while building the Pi runner: the service's MCP mount gives
 * each issued secret ONE stateful transport, so a second MCP client that
 * connects to the same URL (what a fork does when it inherits the base's
 * `mcpServers`) is refused at `initialize`. Checked with the official MCP
 * SDK client, the same SDK the service uses, so this is not a Pi quirk.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startDemo, type Demo } from "./demo.ts";

let demo: Demo;
beforeAll(async () => {
  demo = await startDemo();
});
afterAll(async () => {
  await demo.close();
});

it("a second MCP client on the same secret is refused at initialize", async () => {
  const [server] = demo.mcpFor("base");
  const first = new Client({ name: "base", version: "0" });
  await first.connect(new StreamableHTTPClientTransport(new URL(server!.url!)));
  expect((await first.listTools()).tools.map((t) => t.name)).toContain("get_hunk");

  const second = new Client({ name: "fork", version: "0" });
  const err = await second.connect(new StreamableHTTPClientTransport(new URL(server!.url!))).then(
    () => null,
    (e: unknown) => e,
  );
  console.log("[spike] second client on the same secret:", err instanceof Error ? err.message : err);
  expect(String(err)).toMatch(/already initialized/i);
  await first.close();
});
