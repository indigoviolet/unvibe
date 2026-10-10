/**
 * MCP server config mapping: shared contract -> ACP wire shape.
 *
 * - HTTP (`url` set): `{ type: "http", name, url, headers: [] }`.
 *   Supported by both adapters (Codex does NOT support SSE).
 * - Stdio (`command` set): `{ name, command, args, env: [{name,value}] }`.
 */
import type { McpServerConfig } from "@unvibe/shared";

export type AcpMcpServer =
  | { type: "http"; name: string; url: string; headers: Array<{ name: string; value: string }> }
  | { type: "sse"; name: string; url: string; headers: Array<{ name: string; value: string }> }
  | { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> };

export function toAcpMcpServers(servers: McpServerConfig[]): AcpMcpServer[] {
  return servers.map((s) => {
    if (s.url) {
      return { type: "http", name: s.name, url: s.url, headers: [] };
    }
    if (s.command && s.command.length > 0) {
      const [cmd, ...rest] = s.command;
      const env = Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value }));
      return { name: s.name, command: cmd, args: [...rest, ...(s.args ?? [])], env };
    }
    throw new Error(`McpServerConfig ${JSON.stringify(s.name)} needs url or command`);
  });
}

export function mcpServerNames(servers: McpServerConfig[]): string[] {
  return servers.map((s) => s.name);
}
