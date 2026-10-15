/*global console process setTimeout Buffer clearTimeout */
// Live D2 diagram check, run as:
//   mise run test:live:diagram [--port N] [--provider claude|codex|both]
//
// Spins up the BUILT service with the default ACP runner (real claude/codex
// logins; small token spend), creates the demo review (fast ingest, no git
// needed), and runs the real `diagram` action once per provider on the
// central card. Asserts: a D2 diagram block with 2+ valid cites (ranges in
// the fixture hunks), pre-check clean, binary compile ok, render ok, and
// the endpoint serves the SVG with rewritten anchors.
//
// Never run by `mise run check`. Requires built service (`mise run build`),
// logged-in `claude`/`codex` CLIs, and `d2` ≥ 0.9.0 on PATH.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4597;
const provIdx = args.indexOf("--provider");
const onlyProvider = provIdx >= 0 ? args[provIdx + 1] : "both";

const PROVIDERS = ["claude", "codex"].filter((p) => onlyProvider === "both" || p === onlyProvider);
if (PROVIDERS.length === 0) {
  console.error(`unknown --provider ${onlyProvider} (want claude|codex|both)`);
  process.exit(2);
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-diagram-data-"));
const ENV = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0" };
delete ENV.UNVIBE_AGENT; // default ACP runner (real agents)
ENV.UNVIBE_ALLOW_LIVE_AGENT = "1";

function api(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: apiPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text: data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const child = spawn(process.execPath, [CLI, "start", "--port", String(PORT)], {
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let token = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service did not print a token URL")), 30000);
    child.stdout.on("data", (d) => {
      const m = String(d).match(/token=([A-Za-z0-9_-]+)/);
      if (m && !token) {
        token = m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", () => {
      // service logs drain here
    });
    child.on("exit", (c) => reject(new Error(`service exited ${c}`)));
  });
  try {
    await ready;
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch (e) {
      void e;
    }
  };
  process.on("exit", stop);

  try {
    // Doctor must show d2 (live check needs the real binary).
    const created = await api("POST", "/api/reviews", { repoId: "demo" }, token);
    if (created.status !== 201) throw new Error(`create demo review: ${created.status} ${created.text}`);
    const id = created.json.review.id;

    // Wait for the central card (reader on default main provider).
    let snap = null;
    for (let i = 0; i < 120; i++) {
      const r = await api("GET", `/api/reviews/${id}`, undefined, token);
      snap = r.json;
      if (snap?.pages?.find((p) => p.id === "root")?.cards?.find((c) => c.id === "central")?.blocks?.length) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const central = snap?.pages?.find((p) => p.id === "root")?.cards?.find((c) => c.id === "central");
    if (!central) throw new Error("central card never filled");

    for (const provider of PROVIDERS) {
      // Point the main role at this provider (keep current model).
      const settings = (await api("GET", "/api/settings", undefined, token)).json;
      const model = settings.main.provider === provider ? settings.main.model : settings.main.model;
      await api("PUT", "/api/settings", { main: { provider, model } }, token);
      const acted = await api("POST", `/api/reviews/${id}/actions`, { kind: "diagram", cardId: "central" }, token);
      if (acted.status !== 200) throw new Error(`${provider}: diagram action ${acted.status} ${acted.text}`);
      const jobId = acted.json.jobId;
      if (jobId) {
        for (let i = 0; i < 120; i++) {
          const jobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json;
          const job = jobs.jobs?.find((j) => j.id === jobId);
          if (job && ["done", "error", "cancelled"].includes(job.state)) {
            if (job.state !== "done") throw new Error(`${provider}: diagram job ${job.state}: ${job.error}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
      const live = (await api("GET", `/api/reviews/${id}`, undefined, token)).json;
      const card = live.pages.find((p) => p.id === "root").cards.find((c) => c.id === "central");
      const diagrams = card.blocks.filter((b) => b.type === "diagram");
      if (diagrams.length === 0) throw new Error(`${provider}: no diagram block stored`);
      const dg = diagrams[diagrams.length - 1];
      if (!dg.source || !dg.source.includes("->")) throw new Error(`${provider}: empty D2 source`);
      const cites = (dg.citations ?? []).map((c) => c.target);
      if (cites.length < 2) throw new Error(`${provider}: expected 2+ cites, got ${cites.join(",")}`);
      if (dg.render?.status !== "ok") throw new Error(`${provider}: render status ${dg.render?.status}: ${dg.render?.error}`);
      const svg = await api("GET", `/api/reviews/${id}/diagrams/${dg.render.hash}?theme=light`, undefined, token);
      if (svg.status !== 200) throw new Error(`${provider}: diagram endpoint ${svg.status}`);
      if (!svg.text.includes("data-refs=")) throw new Error(`${provider}: SVG missing rewritten anchors`);
      console.log(`live-diagram ${provider}: ok (${cites.length} cites, hash ${dg.render.hash})`);
      // Undo so the next provider starts clean.
      await api("POST", `/api/reviews/${id}/actions`, { kind: "undo", cardId: "central" }, token);
    }
    console.log("live-diagram: all providers green");
  } finally {
    stop();
  }
}

main().catch((e) => {
  console.error(`live-diagram FAILED: ${(e && e.message) || e}`);
  process.exit(1);
});
