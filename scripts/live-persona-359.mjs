/*global console process setTimeout clearTimeout*/
// Live #359 lens check, run as:
//   mise run test:live:persona-359 -- --cap 0.10 [--provider pi] [--model muse-spark-1.3-contributor]
//
// One persona card turn through the real pipeline on the owner's pi
// login: main's shared base, with the lens at the start of the turn
// (option B). The test persona follows the main model like Clarity and
// carries an unmistakable lens instruction ("End every paragraph ...
// CLARITY-OK"); the check passes when every stored paragraph ends with
// the marker. Bundled demo review only (urllib3#5020, public fixture);
// scratch data dir; no gh writes; priced spend tracked job by job
// (failed jobs included) with a hard cap and no retries past it.
// Report lands in test-results/ (gitignored).
//
// Never run by `mise run check`. Requires built service (`mise run build`)
// and the owner's pi login. Reads nothing of ~/.pi (detection is the pi
// binary + catalogue probes, like pi-live.test.ts).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPriced,
  costOf,
  createSpendTracker,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  parseLiveArgs,
  precheckModelOffered,
  preflightCap,
  resolvePiCmd,
  selectLiveModel,
  worstCaseTurnUsd,
  writeLiveReport,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const live = (() => {
  try {
    return parseLiveArgs(process.argv.slice(2)); // --provider/--model/--cap
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const PI_CMD = resolvePiCmd();
const PORT = 4596;

// Unmistakable lens instruction: every stored paragraph must end with it.
const LENS = [
  "You are Lens-Check, a card-rewrite probe. Rewrite the card's prose",
  "with the same facts and the same citation tokens attached to the same",
  "claims, clearer to an engineer. End every paragraph of your rewrite",
  "with the word CLARITY-OK on its own line.",
].join(" ");

const PERSONA = {
  id: "lens-check",
  name: "Lens check",
  followMain: true,
  provider: "pi",
  model: "muse-spark-1.3-contributor",
  lens: LENS,
  cardInstruction: "Rewrite the card's prose following your lens.",
  enabled: true,
  color: "#1D4ED8",
};

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-359-data-"));
const ENV = {
  ...process.env,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "0",
};
delete ENV.UNVIBE_AGENT; // default factory: pi -> native pi runner
ENV.UNVIBE_ALLOW_LIVE_AGENT = "1";
delete ENV.GITHUB_TOKEN;
delete ENV.GH_TOKEN;
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-359-fakebin-"));
fs.writeFileSync(path.join(fakeBin, "gh"), "#!/bin/sh\necho 'fake gh: writes refused' >&2\nexit 1\n", { mode: 0o755 });
ENV.PATH = `${fakeBin}${path.delimiter}${ENV.PATH ?? ""}`;
ENV.PI_TELEMETRY = "0";
ENV.PI_SKIP_VERSION_CHECK = "1";

function api(method, apiPath, body, token) {
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
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            // leave null
          }
          resolve({ code: res.statusCode, json, raw: data });
        });
      },
    );
    req.on("error", (e) => resolve({ code: 0, json: null, raw: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const sumUsage = (jobs) => {
  const u = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
  for (const j of jobs ?? []) {
    if (!j.usage) continue;
    u.inputTokens += j.usage.inputTokens ?? 0;
    u.cachedReadTokens += j.usage.cachedReadTokens ?? j.usage.cachedTokens ?? 0;
    u.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
    u.outputTokens += j.usage.outputTokens ?? 0;
  }
  return u;
};

const blockText = (b) => {
  const t = b?.text;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return t.standard ?? t.simple ?? t.deep ?? "";
  return "";
};

const main = async () => {
  // Free pre-checks before any spend: pi must list the model and the cap
  // is priced from pi's own catalogue.
  let rates;
  try {
    const hit = precheckModelOffered(PI_CMD, { provider: live.provider, model: live.model }, { env: ENV });
    live.provider = hit.provider;
    live.model = hit.model;
    const catalog = await fetchPiCatalog(PI_CMD, { env: ENV });
    const entry = findCatalogEntry(catalog, { provider: live.provider, model: live.model });
    rates = assertPriced(entry, { provider: live.provider, model: live.model });
    preflightCap({
      capUsd: live.capUsd,
      worstCaseUsd: worstCaseTurnUsd(rates, entry),
      what: "one persona turn worst case",
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const spend = createSpendTracker(rates, live.capUsd);

  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let logged = "";
  child.stdout.on("data", (d) => (logged += d.toString()));
  child.stderr.on("data", (d) => (logged += d.toString()));
  const health = () =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
    });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await health();
  }
  const out = { task: "live-persona-359", provider: live.provider, model: live.model, capUsd: live.capUsd, failures: [] };
  if (!up) {
    console.error(`service did not start:\n${logged.slice(-2000)}`);
    child.kill("SIGKILL");
    process.exit(1);
  }
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  try {
    // Main on the live model; the test persona follows it (like Clarity).
    const put = async (patch) => {
      const r = await api("PUT", "/api/settings", patch, token);
      return { ok: r.code === 200, status: r.code, detail: (r.json?.errors ?? [r.raw.slice(0, 200)]).join("; "), body: r.json };
    };
    await selectLiveModel(put, { provider: live.provider, model: live.model }, ["main"]);
    const seed = (await api("GET", "/api/settings", undefined, token)).json;
    const personas = [...(seed?.personas ?? []), { ...PERSONA, provider: live.provider, model: live.model }];
    const pset = await api("PUT", "/api/settings", { personas }, token);
    if (pset.code !== 200) throw new Error(`personas PUT -> ${pset.code}: ${pset.raw.slice(0, 300)}`);

    // Bundled demo review (public fixture, no gh involved).
    const created = await api("POST", "/api/reviews", { repoId: "demo" }, token);
    if (created.code !== 201) throw new Error(`review create -> ${created.code}: ${created.raw.slice(0, 300)}`);
    const id = created.json.review.id;
    out.reviewId = id;
    const t0 = Date.now();
    for (;;) {
      const got = await api("GET", `/api/reviews/${id}`, undefined, token);
      const cards = (got.json?.pages ?? []).flatMap((p) => p.cards ?? []);
      if (cards.find((c) => c.id === "central")?.blocks?.length) break;
      if (Date.now() - t0 > 10 * 60_000) throw new Error("reader never landed");
      // Mid-run cap guard (reader spend counts too): jobs report cumulative
      // usage, so estimate from the snapshot without accumulating.
      const lj = await api("GET", `/api/jobs?review=${id}`, undefined, token);
      if (costOf(sumUsage(lj.json?.jobs), rates) > live.capUsd) {
        throw new Error(`cap exceeded during reader: priced spend ${formatUsd(costOf(sumUsage(lj.json?.jobs), rates))} > cap ${formatUsd(live.capUsd)}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    const guide = (await api("GET", `/api/reviews/${id}`, undefined, token)).json;
    const guideCentral = (guide.pages ?? []).flatMap((p) => p.cards ?? []).find((c) => c.id === "central");
    out.guideExcerpt = (guideCentral?.blocks ?? []).map(blockText).join("\n\n").slice(0, 400);

    // The one persona turn.
    const acted = await api("POST", `/api/reviews/${id}/actions`, { kind: "persona", cardId: "central", personaId: "lens-check" }, token);
    if (acted.code !== 200) throw new Error(`persona action -> ${acted.code}: ${acted.raw.slice(0, 300)}`);
    let variant = null;
    const t1 = Date.now();
    for (;;) {
      const got = await api("GET", `/api/reviews/${id}`, undefined, token);
      if (got.code !== 200) throw new Error(`GET review -> ${got.code}`);
      const card = (got.json?.pages ?? []).flatMap((p) => p.cards ?? []).find((c) => c.id === "central");
      variant = card?.variants?.["lens-check"] ?? null;
      const lj = await api("GET", `/api/jobs?review=${id}`, undefined, token);
      if (costOf(sumUsage(lj.json?.jobs), rates) > live.capUsd) {
        out.failures.push(`cap exceeded mid-turn: priced spend ${formatUsd(costOf(sumUsage(lj.json?.jobs), rates))} > cap ${formatUsd(live.capUsd)} (failed jobs included)`);
        break;
      }
      if (variant && (variant.blocks?.length ?? 0) > 0 && !variant.working) break;
      if (variant?.error) break;
      if (Date.now() - t1 > 8 * 60_000) {
        out.failures.push("persona turn never stored within 8 minutes");
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    const lj = await api("GET", `/api/jobs?review=${id}`, undefined, token);
    spend.add(sumUsage(lj.json?.jobs));
    const finalSpend = spend.usd();
    out.spendUsd = Math.round(finalSpend * 10000) / 10000;
    out.usageByJobs = sumUsage(lj.json?.jobs);
    out.variantRevision = variant?.revision ?? null;
    out.variantError = variant?.error ?? null;
    const paras = (variant?.blocks ?? []).filter((b) => b?.type === "paragraph").map(blockText);
    out.paragraphs = paras.length;
    out.allEndWithMarker = paras.length > 0 && paras.every((t) => t.trimEnd().endsWith("CLARITY-OK"));
    out.variantExcerpt = (variant?.blocks ?? []).map(blockText).join("\n\n").slice(0, 600);
    if (!variant || (variant.blocks?.length ?? 0) === 0) out.failures.push("no variant stored");
    else if (variant.error) out.failures.push(`variant error: ${String(variant.error).slice(0, 200)}`);
    else if (!out.allEndWithMarker) out.failures.push(`lens not followed: ${paras.length} paragraph(s), not all end with CLARITY-OK`);
    try {
      spend.check("live persona-359 (final)");
    } catch (e) {
      out.failures.push(e instanceof Error ? e.message : String(e));
    }
    console.log(`spend ${formatUsd(out.spendUsd)} (cap ${formatUsd(live.capUsd)}), paragraphs=${out.paragraphs}, allEndWithMarker=${out.allEndWithMarker}`);
    if (out.failures.length > 0) console.log(`FAILURES:\n- ${out.failures.join("\n- ")}`);
  } catch (e) {
    out.failures.push(e instanceof Error ? e.message : String(e));
    console.log(`FAILURES:\n- ${out.failures.join("\n- ")}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  const reportPath = writeLiveReport({ dir: path.join(ROOT, "test-results"), task: "live-persona-359", ...out });
  console.log(`report: ${reportPath}`);
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
  process.exit(out.failures.length > 0 ? 1 : 0);
};

main();
