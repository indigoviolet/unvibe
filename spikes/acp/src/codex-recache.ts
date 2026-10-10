/** Supplemental: fresh codex session + byte-identical pack message -> usage? */
import { SpikeClient, fmtUsage, cacheShare } from "./acp-client.js";
import { startMcpServer } from "./mcp-server.js";
import { buildPack, basePackMessage } from "./pack.js";

const mcp = await startMcpServer();
const client = new SpikeClient();
const extraPath = [
  "/home/venky/.local/share/mise/installs/claude-code/latest",
  "/home/venky/.local/share/mise/installs/codex/latest/bin",
  "/home/venky/.local/bin",
].join(":");

await client.run(
  process.execPath,
  ["node_modules/@agentclientprotocol/codex-acp/dist/index.js"],
  { PATH: `${extraPath}:${process.env.PATH}`, NO_BROWSER: "1" },
  async (ctx: any) => {
    await ctx.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const pack = buildPack();
    const msg = basePackMessage(pack);
    console.log(`pack bytes=${pack.bytes} approxTokens=${pack.approxTokens}`);
    for (const tag of ["A", "B"]) {
      const s = await ctx.request("session/new", {
        cwd: process.cwd(),
        mcpServers: [{ type: "http", name: "unvibe-spike", url: mcp.url, headers: [] }],
      });
      const t = await client.prompt(ctx, s.sessionId, msg, { timeoutMs: 900_000 });
      console.log(
        `fresh-${tag} reply=${JSON.stringify(t.text.slice(0, 60))} usage=[${fmtUsage(t.response.usage)}] share=${cacheShare(t.response.usage)}`,
      );
      await ctx.request("session/close", { sessionId: s.sessionId }).catch(() => {});
    }
  },
);
await mcp.close();
