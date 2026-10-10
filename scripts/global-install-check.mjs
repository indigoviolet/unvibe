/*global console process setTimeout Buffer */
 // Global-install check (PRD §14 install path), run as:
//   node scripts/global-install-check.mjs [--port N]
//
// Verifies `npm install -g <tarball>` into a temporary prefix, then runs
// `unvibe doctor` and `unvibe start`/`status`/`stop` from OUTSIDE the repo.
// This exercises the hard parts: workspaces + devDependencies in the
// packed tree, root bin linkage, and dist/prompts resolution relative to
// the installed package (not the repo).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4593;

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-global-"));
const PREFIX = path.join(TMP, "prefix");
const HOME = path.join(TMP, "home");
const DATA = path.join(TMP, "data");
fs.mkdirSync(PREFIX, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
const ENV = {
  ...process.env,
  HOME,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "0",
  // Demo review below runs the recorded pipeline (no tokens) from the
  // installed copy: fixtures + prompts must resolve outside the repo.
  UNVIBE_AGENT: "replay",
  PATH: `${path.join(PREFIX, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
};

console.log(`work dir: ${TMP}`);

// 1. pack ----------------------------------------------------------------------
{
  const r = spawnSync("npm", ["pack", "--pack-destination", TMP], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
  assert(r.status === 0, `npm pack (${(r.stderr ?? "").split("\n").slice(-2).join(" ")})`);
}
const tarball = fs.readdirSync(TMP).find((f) => f.endsWith(".tgz"));
assert(!!tarball, `tarball produced (${tarball ?? "none"})`);

// 2. install -g into the temp prefix ---------------------------------------------
{
  const r = spawnSync("npm", ["install", "-g", path.join(TMP, tarball), "--prefix", PREFIX], {
    // Outside the repo on purpose: nothing must resolve via the checkout.
    cwd: os.tmpdir(),
    env: ENV,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (r.status !== 0) console.error(r.stdout, r.stderr);
  assert(r.status === 0, "npm install -g <tarball> --prefix");
}
const UNVIBE = path.join(PREFIX, "bin", "unvibe");
assert(fs.existsSync(UNVIBE), "unvibe bin linked in the prefix");

const runInstalled = (cmdArgs) => {
  const r = spawnSync(process.execPath, [UNVIBE, ...cmdArgs], {
    cwd: os.tmpdir(),
    env: ENV,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

// 3. doctor -----------------------------------------------------------------------
{
  const d = runInstalled(["doctor"]);
  console.log(d.out);
  assert(d.code === 0, "unvibe doctor exits 0 from the global install");
  assert(d.out.includes("[ok] node"), "doctor reports node");
  assert(d.out.includes("data dir"), "doctor reports the data dir");
}

// 4. start / status / stop ----------------------------------------------------------
const health = () =>
  new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });

async function waitFor(want, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await health()) === want) return true;
    if (Date.now() >= deadline) {
      console.error(`timeout waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const main = async () => {
  const start = runInstalled(["start"]);
  assert(start.code === 0, `unvibe start (${start.out.trim().split("\n")[0]})`);
  assert(await waitFor(true, 20_000, "health"), "globally installed service answers");
  assert(start.out.includes(`http://127.0.0.1:${PORT}/?token=`), "start prints the token URL");

  // Prompts + web dist resolve relative to the installed package.
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const prompts = await new Promise((resolve) => {
    http
      .get(
        { host: "127.0.0.1", port: PORT, path: "/api/prompts", headers: { authorization: `Bearer ${token}` } },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => resolve({ code: res.statusCode, body }));
        },
      )
      .on("error", () => resolve({ code: 0, body: "" }));
  });
  assert(prompts.code === 200 && prompts.body.includes("instructions"), "prompts resolve from the installed package");
  const shell = await new Promise((resolve) => {
    http
      .get({ host: "127.0.0.1", port: PORT, path: `/start.html` }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", () => resolve(0));
  });
  assert(shell === 200, "web dist serves from the installed package");

  // Demo review from the installed copy (recorded pipeline, no tokens).
  const api = (method, apiPath, body) =>
    new Promise((resolve) => {
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
          res.on("end", () => resolve({ code: res.statusCode, body: data }));
        },
      );
      req.on("error", () => resolve({ code: 0, body: "" }));
      if (payload) req.write(payload);
      req.end();
    });
  {
    const created = await api("POST", "/api/reviews", { repoId: "demo" });
    assert(created.code === 201, "installed copy creates the demo review");
    let snap = null;
    try {
      snap = JSON.parse(created.body);
    } catch {
      snap = null;
    }
    const id = snap?.review?.id;
    assert(typeof id === "string", "demo review has an id");
    if (typeof id === "string") {
      let done = false;
      for (let i = 0; i < 40 && !done; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const got = await api("GET", `/api/reviews/${id}`);
        try {
          const s = JSON.parse(got.body);
          const root = (s.pages ?? []).find((p) => p.id === "root");
          done =
            got.code === 200 &&
            (root?.cards ?? []).length >= 6 &&
            !(root?.cards ?? []).some((c) => c.pending) &&
            (s.pages ?? []).filter((p) => p.kind === "finding").length >= 2;
          if (done) {
            assert(true, "demo pipeline completes from the installed copy");
            const hunks = (s.hunkStates ?? []).filter((h) => h.summary).length;
            assert(hunks >= 8, `demo hunk summaries present (${hunks})`);
          }
        } catch {
          // keep polling
        }
      }
      assert(done, "demo snapshot ends complete (60s budget)");
    }
  }

  const status = runInstalled(["status"]);
  assert(status.code === 0 && status.out.includes("running"), "status reports running");
  const stop = runInstalled(["stop"]);
  assert(stop.code === 0 && (await waitFor(false, 10_000, "shutdown")), "stop shuts the service down");

  if (failures > 0) {
    console.error(`${failures} assertion(s) failed (work dir kept: ${TMP})`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("global-install-check: all green");
};

await main();
