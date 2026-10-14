/**
 * Unvibe's per-session MCP servers -> Pi custom tools.
 *
 * The runner gets the same `McpServerConfig[]` the ACP runner gets (HTTP
 * URLs on the service's loopback MCP mount). Instead of handing them to an
 * agent CLI that may or may not wire them into a fork (#124), the runner
 * connects to them itself with Pi's standalone MCP client and registers each
 * tool as a Pi tool. A fork re-registers the same tools, so a fork can never
 * come up without them.
 *
 * Tool names stay the bare MCP names (`get_hunk`, `get_code`, ...), which is
 * how `prompts/` refers to them.
 */
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { McpServerConfig } from "../../../packages/shared/src/agent.ts";

export interface BridgedTools {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

export async function bridgeMcpServers(servers: McpServerConfig[]): Promise<BridgedTools> {
  const clients: McpClient[] = [];
  const tools: ToolDefinition[] = [];
  try {
    for (const server of servers) {
      if (!server.url) {
        // Unvibe only issues HTTP servers (src/mcp/registry.ts); stdio would
        // be a StdioTransport here.
        throw new Error(`MCP server ${server.name}: only url servers are bridged in the spike`);
      }
      const client = new McpClient({ name: "unvibe-pi-runner", version: "0.0.0" });
      await client.connect(new StreamableHttpTransport({ url: server.url, openGetStream: false }));
      clients.push(client);
      for (const tool of await client.listTools()) {
        tools.push({
          name: tool.name,
          label: tool.title ?? tool.name,
          description: tool.description ?? tool.name,
          parameters: Type.Unsafe({
            ...tool.inputSchema,
            type: "object",
            properties: tool.inputSchema.properties ?? {},
          }),
          async execute(_toolCallId, params, signal) {
            const result = await client.callTool(tool.name, params as Record<string, unknown>, { signal });
            return { content: toLlmContent(result), details: undefined, isError: result.isError === true };
          },
        } as ToolDefinition);
      }
    }
  } catch (err) {
    await Promise.allSettled(clients.map((c) => c.close()));
    throw err;
  }
  return {
    tools,
    async close() {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
