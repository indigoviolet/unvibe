/** Minimal fork repro: new -> prompt -> fork -> prompt fork. */
import { SpikeClient } from "./acp-client.js";

const client = new SpikeClient();
const extraPath = [
  "/home/venky/.local/share/mise/installs/claude-code/latest",
  "/home/venky/.local/share/mise/installs/codex/latest/bin",
  "/home/venky/.local/bin",
].join(":");

await client.run(
  process.execPath,
  ["node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  { PATH: `${extraPath}:${process.env.PATH}`, NO_BROWSER: "1" },
  async (ctx: any) => {
    await ctx.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    const cwd = process.cwd();
    const base = await ctx.request("session/new", { cwd, mcpServers: [] });
    console.log("base", base.sessionId);
    const t0 = await client.prompt(ctx, base.sessionId, "Reply with exactly the word READY and nothing else.");
    console.log("base reply", JSON.stringify(t0.text), "stop", t0.response.stopReason);
    await new Promise((r) => setTimeout(r, 2000));
    const fork = await ctx.request("session/fork", { sessionId: base.sessionId, cwd });
    console.log("fork", fork.sessionId);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const t1 = await client.prompt(ctx, fork.sessionId, "Reply with exactly the word FORKED and nothing else.");
      console.log("fork reply", JSON.stringify(t1.text), "stop", t1.response.stopReason);
      console.log("usage", JSON.stringify(t1.response.usage));
    } catch (e) {
      console.log("FORK PROMPT FAILED:", String(e).slice(0, 500));
    }
    // also try sequential second fork prompt
    try {
      const t2 = await client.prompt(ctx, fork.sessionId, "Reply with exactly the word AGAIN and nothing else.");
      console.log("fork reply2", JSON.stringify(t2.text), "stop", t2.response.stopReason);
    } catch (e) {
      console.log("FORK PROMPT 2 FAILED:", String(e).slice(0, 500));
    }
  },
);
