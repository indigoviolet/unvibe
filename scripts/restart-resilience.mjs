/*global console process setTimeout Buffer */
// Restart resilience (PRD §16): SIGKILL the service at awkward moments,
// restart, and verify no user data is lost, interrupted jobs are visible
// and retryable, and sessions rebuild.
//
// Run as: node scripts/restart-resilience.mjs [--port N]
// Uses the built service (`mise run build` first) in demo mode
// (`UNVIBE_AGENT=replay`: recorded pipeline, no tokens, no network).
// Never touches the repo or GitHub.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunRoot, onExit, removeDir } from "./tmp-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages", "service", "dist", "index.js");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

// Per-run temp root (issue #24): removed by exact path on success,
// failure and interruption. Never globs the system temp dir.
const TMP = createRunRoot();
const DATA = path.join(TMP, "data");
fs.mkdirSync(DATA, { recursive: true });
const PORT = Number(flag("--port", "0")) || (await freePort());
console.log(`work dir: ${TMP} port: ${PORT}`);

const ENV = {
  ...process.env,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "0",
  UNVIBE_AGENT: "replay",
};

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });
}

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

/** Foreground service child we can SIGKILL. Resolves when healthy. */
let currentChild = null;
onExit(() => {
  // Interruption net: kill only the service child we started (by recorded
  // PID), then remove only our own root. Never kills by pattern or port.
  try {
    currentChild?.kill("SIGKILL");
  } catch {
    // best effort
  }
  removeDir(TMP);
});
async function startService(label) {
  const child = spawn(process.execPath, [DIST, "start", "--foreground"], {
    cwd: os.tmpdir(),
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  currentChild = child;
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const ok = await waitFor(true, 20_000, `${label} health`);
  assert(ok, `${label}: service (re)starts cleanly`);
  return child;
}

function kill9(child, label) {
  try {
    child.kill("SIGKILL");
  } catch (e) {
    assert(false, `${label}: SIGKILL (${String(e).slice(0, 100)})`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.on("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
}

function api(token, method, apiPath, body) {
  return new Promise((resolve) => {
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
}

const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  assert(fs.existsSync(DIST), `built service exists (${DIST})`);

  // 1. Start, create the demo review, SIGKILL mid-pipeline. -----------------
  let svc = await startService("first start");
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const created = await api(token, "POST", "/api/reviews", { repoId: "demo" });
  assert(created.code === 201, "demo review created");
  const id = json(created.body)?.review?.id;
  assert(typeof id === "string", "demo review has an id");

  await sleep(1000); // reader/critic stage in flight (replay streams)
  const mid = json((await api(token, "GET", `/api/reviews/${id}`)).body);
  console.log(`  mid-pipeline: ${mid?.pages?.length ?? 0} pages, ${(mid?.jobs ?? []).length} jobs`);
  await kill9(svc, "mid-reader SIGKILL");
  assert(!(await health()), "service is down after SIGKILL");

  // Stale lock: the next start must clean it, not reuse a dead pid.
  const st = spawnSync(process.execPath, [DIST, "status"], { env: ENV, encoding: "utf8" });
  assert(st.status === 1 && /not running/.test(st.stdout), "status reports not running after SIGKILL (stale lock ignored)");

  // 2. Restart: no data lost, interrupted jobs visible, resume completes. ---
  svc = await startService("restart after SIGKILL");
  const after = await api(token, "GET", `/api/reviews/${id}`);
  assert(after.code === 200, "snapshot survives SIGKILL");
  const snap = json(after.body);
  assert((snap?.pages?.length ?? 0) > 0, `pages persisted (${snap?.pages?.length ?? 0})`);

  const jobs = json((await api(token, "GET", `/api/jobs?review=${id}`)).body)?.jobs ?? [];
  const open = jobs.filter((j) => !["done", "error", "cancelled"].includes(j.state));
  const interrupted = jobs.filter((j) => j.state === "error" && /interrupt/i.test(j.error ?? ""));
  console.log(`  after restart: ${jobs.length} jobs, ${open.length} open, ${interrupted.length} interrupted`);
  assert(jobs.length > 0, "jobs survived the restart");
  assert(open.length === 0, "no job left running/queued phantom after restart");

  const resume = await api(token, "POST", `/api/reviews/${id}/resume`, {});
  assert(resume.code === 200, `resume accepted (${resume.code})`);
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    await sleep(1000);
    const got = json((await api(token, "GET", `/api/reviews/${id}`)).body);
    const root = (got?.pages ?? []).find((p) => p.id === "root");
    done =
      (root?.cards ?? []).length >= 6 &&
      !(root?.cards ?? []).some((c) => c.pending) &&
      (got?.pages ?? []).filter((p) => p.kind === "finding").length >= 2;
  }
  assert(done, "pipeline completes after resume (no work lost, no duplicates)");

  // 2b. Completed jobs survive a restart (issue #117): the Debug page's
  // jobs endpoint lists the persisted rows, not just recovered open jobs.
  const jobsBefore = json((await api(token, "GET", `/api/jobs?review=${id}`)).body)?.jobs ?? [];
  await kill9(svc, "post-complete SIGKILL");
  svc = await startService("restart after completion");
  const jobsAfter = json((await api(token, "GET", `/api/jobs?review=${id}`)).body)?.jobs ?? [];
  const openAfter = jobsAfter.filter((j) => !["done", "error", "cancelled"].includes(j.state));
  console.log(`  completed then restarted: ${jobsBefore.length} jobs before, ${jobsAfter.length} after`);
  assert(
    jobsAfter.length >= jobsBefore.length,
    `finished jobs still listed after restart (${jobsAfter.length} >= ${jobsBefore.length})`,
  );
  assert(jobsAfter.some((j) => j.state === "done"), "finished jobs keep their state after restart");
  assert(openAfter.length === 0, "no job left running/queued phantom after a completed restart");

  // 3. Mid-ask SIGKILL: card survives, reply answers. ------------------------
  const live = json((await api(token, "GET", `/api/reviews/${id}`)).body);
  const problem = (live?.pages ?? []).find((p) => p.id === "root")?.cards?.[0];
  const blockId = problem?.blocks?.[0]?.id ? `${problem.id}#${problem.blocks[0].id}` : undefined;
  assert(!!blockId, "guide has an anchored block for ask");
  let askId = null;
  if (blockId) {
    const ask = await api(token, "POST", `/api/reviews/${id}/actions`, {
      kind: "ask",
      quote: "test",
      anchor: { where: "block", blockId },
      message: "What does this mean?",
    });
    assert(ask.code === 200, `ask accepted (${ask.code})`);
    askId = json(ask.body)?.annotationId ?? null;
    await sleep(400); // agent turn streaming
    await kill9(svc, "mid-ask SIGKILL");
    svc = await startService("restart after mid-ask SIGKILL");
    const t = json((await api(token, "GET", `/api/reviews/${id}`)).body)?.annotations?.find((a) => a.id === askId);
    assert(!!t, "ask card survives SIGKILL");
    console.log(`  card after restart: replies=${(t?.replies ?? []).length} working=${t?.working ?? null} error=${(t?.error ?? "").slice(0, 60) || null}`);
    // Retry the failed fill (or reply when it already answered).
    const hasAnswer = ((t?.replies ?? [])[0]?.blocks ?? []).length > 0;
    const path = hasAnswer ? "reply" : "retry";
    const again = await api(
      token,
      "POST",
      `/api/reviews/${id}/actions`,
      hasAnswer
        ? { kind: "reply", annotationId: askId, message: "And why?" }
        : { kind: "retry", annotationId: askId },
    );
    assert(again.code === 200, `${path} after restart accepted (${again.code})`);
    let answered = false;
    for (let i = 0; i < 45 && !answered; i++) {
      await sleep(1000);
      const cur = json((await api(token, "GET", `/api/reviews/${id}`)).body)?.annotations?.find((a) => a.id === askId);
      const replies = cur?.replies ?? [];
      answered = replies.length >= (hasAnswer ? 2 : 1) && replies.every((x) => (x.blocks ?? []).length > 0) && !cur?.working;
    }
    assert(answered, "conversation recovers after restart (no lost card)");
  }

  // 3b. Conversation card (issue #136 slice 1): Explain, follow up,
  // SIGKILL mid-follow-up, restart, reply again on the same card. The
  // card's session rebuilds from the stored turns; no turn is lost. -----
  if (blockId) {
    // A different quote from section 3's ask: identical quote+anchor
    // would (correctly, PRD §12) reopen that card instead of a new one.
    const explain = await api(token, "POST", `/api/reviews/${id}/actions`, {
      kind: "explain",
      quote: "test conversation",
      anchor: { where: "block", blockId },
    });
    assert(explain.code === 200, `explain accepted (${explain.code})`);
    const cardId = json(explain.body)?.annotationId ?? null;
    let firstFilled = false;
    for (let i = 0; i < 45 && !firstFilled; i++) {
      await sleep(1000);
      const cur = json((await api(token, "GET", `/api/reviews/${id}`)).body)?.annotations?.find((a) => a.id === cardId);
      firstFilled = ((cur?.replies ?? [])[0]?.blocks ?? []).length > 0 && !cur?.working;
    }
    assert(firstFilled, "explain first turn fills");
    const follow = await api(token, "POST", `/api/reviews/${id}/actions`, {
      kind: "reply",
      annotationId: cardId,
      message: "And why?",
    });
    assert(follow.code === 200, `follow-up accepted (${follow.code})`);
    await sleep(400); // second turn streaming
    await kill9(svc, "mid-follow-up SIGKILL");
    svc = await startService("restart after mid-follow-up SIGKILL");
    const c = json((await api(token, "GET", `/api/reviews/${id}`)).body)?.annotations?.find((a) => a.id === cardId);
    assert(!!c && (c.replies ?? []).length >= 1, "conversation card survives SIGKILL");
    console.log(
      `  card after restart: replies=${(c?.replies ?? []).length} working=${c?.working ?? null} error=${(c?.error ?? "").slice(0, 60) || null} session=${c?.sessionId ? "yes" : "no"} questions=${JSON.stringify((c?.replies ?? []).map((t) => t.question))}`,
    );
    // Reply again on the same card: the session rebuilds from the stored turns.
    const again2 = await api(token, "POST", `/api/reviews/${id}/actions`, {
      kind: "reply",
      annotationId: cardId,
      message: "And then?",
    });
    assert(again2.code === 200, `reply on conversation after restart accepted (${again2.code})`);
    let recovered = false;
    for (let i = 0; i < 45 && !recovered; i++) {
      await sleep(1000);
      const cur = json((await api(token, "GET", `/api/reviews/${id}`)).body)?.annotations?.find((a) => a.id === cardId);
      const replies = cur?.replies ?? [];
      recovered = replies.length >= 3 && replies.every((t) => (t.blocks ?? []).length > 0) && !cur?.working;
    }
    assert(recovered, "conversation recovers after restart (follow-up turns kept)");
  }

  // 4. Clean shutdown + fresh start through the CLI. -------------------------
  await kill9(svc, "final SIGKILL");
  assert(!(await health()), "service down at the end");
  const start = spawnSync(process.execPath, [DIST, "start"], { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 60_000 });
  assert(start.status === 0, "a new request after exit starts cleanly through the CLI");
  assert(await waitFor(true, 20_000, "post-exit health"), "service answers after CLI restart");
  const stop = spawnSync(process.execPath, [DIST, "stop"], { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 30_000 });
  assert(stop.status === 0 && (await waitFor(false, 10_000, "final shutdown")), "stop shuts down");

  if (failures > 0) {
    console.error(`${failures} assertion(s) failed (work dir removed: ${TMP})`);
    try {
      currentChild?.kill("SIGKILL");
    } catch {
      // best effort
    }
    removeDir(TMP);
    process.exit(1);
  }
  try {
    currentChild?.kill("SIGKILL");
  } catch {
    // best effort
  }
  currentChild = null;
  removeDir(TMP);
  console.log("restart-resilience: all green");
};

await main();
