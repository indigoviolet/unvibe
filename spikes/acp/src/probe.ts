/**
 * Probe: spawn an adapter, initialize, print capabilities. Validates the
 * harness + adapter launch before spending tokens on real turns.
 *
 * Usage: npx tsx src/probe.ts claude|codex
 */
import { SpikeClient } from "./acp-client.js";

const which = process.argv[2] ?? "claude";
const adapterPkg =
  which === "claude"
    ? "@agentclientprotocol/claude-agent-acp"
    : "@agentclientprotocol/codex-acp";

const client = new SpikeClient();
const extraPath = `/home/venky/.local/share/mise/installs/claude-code/latest:/home/venky/.local/share/mise/installs/codex/latest/bin:/home/venky/.local/bin`;
await client.run(
  process.execPath,
  [`node_modules/${adapterPkg}/dist/index.js`],
  {
    PATH: `${extraPath}:${process.env.PATH}`,
    NO_BROWSER: "1",
  },
  async (ctx: any) => {
    const init = await ctx.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
    });
    console.log("=== initialize result ===");
    console.log(JSON.stringify(init, null, 1).slice(0, 4000));
  },
);
