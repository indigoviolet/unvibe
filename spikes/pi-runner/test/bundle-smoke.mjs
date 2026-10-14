/* global process, console */
// Runs the esbuild bundle of the Pi runner (copied away from node_modules)
// against the fake backend: proves the bundle is self-contained.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [bundleDir] = process.argv.slice(2);
const { PiAgentRunner } = await import(path.join(bundleDir, "pi-runner.js"));
const { startFakeCodex, fakeChatGptToken } = await import(path.join(bundleDir, "fake-codex.js"));
const fake = await startFakeCodex();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike-pi-bundle-"));
fs.mkdirSync(path.join(dir, "agent")); fs.mkdirSync(path.join(dir, "wt"));
fs.writeFileSync(path.join(dir, "agent", "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: fakeChatGptToken(), refresh: "r", expires: 4102444800000, accountId: "acct-fake" } }));
const runner = new PiAgentRunner({ agentDir: path.join(dir, "agent"), sessionDir: path.join(dir, "s"), transport: "sse", mapModel: (m) => ({ ...m, baseUrl: fake.baseUrl }) });
const s = await runner.start({ provider: "pi", model: "gpt-6.1-sol", cwd: path.join(dir, "wt"), systemPrompt: "L0", mcpServers: [] });
fake.script.push({ text: "bundled ok" });
let out = ""; for await (const e of runner.prompt(s, "hi")) { if (e.type === "text") out += e.delta; else console.log(JSON.stringify(e).slice(0,300)); }
const f = await runner.fork(s); fake.script.push({ text: "fork ok" });
for await (const e of runner.prompt(f, "again")) if (e.type === "text") out += " | " + e.delta;
console.log(JSON.stringify({ out, rssMb: Math.round(process.memoryUsage().rss / 1048576) }));
await runner.dispose(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true });
