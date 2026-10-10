/**
 * Trivial local HTTP MCP server for the M0 ACP spike.
 *
 * Exposes a single tool, `get_hunk(id)`, returning a fixed string. Every
 * call is recorded (with timestamp) so the spike can prove the agent actually
 * invoked the MCP tool through the adapter.
 *
 * Run directly: `npx tsx src/mcp-server.ts` (binds 127.0.0.1:0, prints URL).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface HunkCall {
  at: string;
  id: string;
}

export interface StartedMcpServer {
  url: string;
  calls: HunkCall[];
  close: () => Promise<void>;
}

export async function startMcpServer(): Promise<StartedMcpServer> {
  const calls: HunkCall[] = [];
  const server = new McpServer({ name: "unvibe-spike", version: "0.0.0" });
  server.tool(
    "get_hunk",
    "Return the text of a review hunk by id (spike stub: fixed string).",
    { id: z.string().describe("Hunk id, e.g. h:sp:abc123") },
    async ({ id }) => {
      calls.push({ at: new Date().toISOString(), id });
      return {
        content: [
          {
            type: "text" as const,
            text: `HUNK:${id}:fixed-content:alpha-bravo-42`,
          },
        ],
      };
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: one POST per request
  });
  await server.connect(transport);

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end("not found");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown = undefined;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      transport.handleRequest(req, res, parsed).catch((e) => {
        if (!res.headersSent) res.writeHead(500).end(String(e));
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const addr = http.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        http.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startMcpServer();
  console.log(`MCP server at ${s.url}`);
  console.log("tool: get_hunk(id) -> fixed string. Ctrl-C to stop.");
}
