/*global console process */
// Curate a live re-record capture into `fixtures/urllib3-5020/` (#341).
// Usage: node scripts/curate-rerecord-341.mjs <captureDir> <reportJson> <questionsJson>
//
// Reads the harness report (fired[] statuses) + capture index.jsonl,
// copies each capture to its fixture recording name, and rewrites
// manifest.json (recordedWith model + promptHash + per-kind entries).
// Keyed kinds map by marker key; kind-only kinds (explain/ask/diagram)
// map by fire order, skipping reused/deduplicated entries (which produce
// no capture). Refuses on any count mismatch instead of guessing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "fixtures", "urllib3-5020");
const REC = path.join(FIX, "recordings");

const [captureDir, reportPath, questionsPath] = process.argv.slice(2);
if (!captureDir || !reportPath || !questionsPath) {
  console.error("usage: node scripts/curate-rerecord-341.mjs <captureDir> <reportJson> <questionsJson>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const questions = JSON.parse(fs.readFileSync(questionsPath, "utf8"));
const index = fs.readFileSync(path.join(captureDir, "index.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const byKind = {};
for (const e of index) (byKind[e.kind] ??= []).push(e);

const fail = (m) => { console.error(`curate: refusing: ${m}`); process.exit(2); };

const firedStatus = (entry) => (report.fired ?? []).find((f) => f.entry === entry)?.status ?? "(missing)";

// Keyed kinds: marker key → capture file (exact, order-free).
const keyed = (kind, key) => {
  const hits = (byKind[kind] ?? []).filter((e) => e.key === key);
  if (hits.length !== 1) fail(`${kind} key ${key === null ? "(kind-only)" : key}: ${hits.length} captures`);
  return hits[0];
};

const out = {}; // fixture filename → capture source path
const take = (kind, key, dest) => {
  out[dest] = path.join(captureDir, keyed(kind, key).file);
};

// Kind-only kinds: fire order, skipping reused/deduplicated.
const ordered = (kind, entries, destFn) => {
  const files = (byKind[kind] ?? []).map((e) => e.file);
  const want = entries.filter((en) => !["reused", "deduplicated"].includes(firedStatus(en.entry)));
  if (files.length < want.length) fail(`${kind}: ${files.length} captures for ${want.length} live entries`);
  if (files.length > want.length) fail(`${kind}: ${files.length} captures exceed ${want.length} live entries (unexpected extra turn?)`);
  want.forEach((en, i) => { out[destFn(en)] = path.join(captureDir, files[i]); });
};

// --- reader / critic (single entries) ---
take("reader", null, "reader.md");
take("critic", null, "critic.md");

// --- hunks (short prototype keys, as captured) ---
for (const f of ["conn-0", "conn-1", "tconn-0", "tconn-1", "tconn-2", "tsock-0", "tsock-1", "log-0"]) {
  const [short, n] = f.split("-");
  take("hunk", `${short}:${n}`, `hunk-${f}.md`);
}

// --- go-deeper (pending-card keys from the reader) ---
const godeeperKeys = questions.godeeperKeys;
if (!Array.isArray(godeeperKeys) || godeeperKeys.length === 0) fail("questions.godeeperKeys missing (pending-card keys from the reader capture)");
// Marker keys carry the target level (simple/deep), not the action
// direction (simpler/deeper) — mirror depth.ts replayKey.
const depthKey = (d) => `${d.cardId}:${d.direction === "simpler" ? "simple" : "deep"}`;
const depthFile = (d) => `depth-${d.cardId}-${d.direction === "simpler" ? "simple" : "deep"}.md`;
for (const k of godeeperKeys) take("go-deeper", k, `go-deeper-${k}.md`);

// --- concept pages (glossary slugs, lowercased marker keys) ---
const slugFile = (s) => s.toLowerCase().replace(/^_+|-+$/g, "").replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]+/g, "");
for (const slug of questions.concept ?? []) take("concept-page", slug.toLowerCase(), `concept-${slugFile(slug)}.md`);

// --- depth / examples (card ids) ---
for (const d of questions.depth ?? []) {
  if (["reused", "deduplicated"].includes(firedStatus(`depth:${d.cardId}:${d.direction}`))) continue; // stored text; covered by extraManifest
  take("depth", depthKey(d), depthFile(d));
}
for (const cardId of questions.examples ?? []) take("examples", cardId, `examples-${cardId}.md`);

// --- diagram (kind-only, fire order = questions.diagram order) ---
ordered("diagram", (questions.diagram ?? []).map((cardId) => ({ entry: `diagram:${cardId}`, cardId })), (en) => `diagram-${en.cardId}.md`);

// --- explain / ask (kind-only, patterns decide at runtime) ---
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const explainPat = (e) => [e.quote, ...(e.message ? [e.message] : [])].map((s) => esc(s.slice(0, 48))).join("|");
ordered("explain", (questions.explain ?? []).map((e) => ({ entry: `explain:${e.key}`, ...e })), (en) => `explain-${en.key}.md`);
ordered("ask", (questions.ask ?? []).map((a) => ({ entry: `ask:${a.key}`, ...a })), (en) => `ask-${en.key}.md`);

const manifest = { recordings: [] };
const push = (entry) => manifest.recordings.push(entry);
const extra = questions.extraManifest ?? [];
const extraFor = (kind, key) => extra.filter((e) => e.kind === kind && (key === undefined || e.key === key));
push({ kind: "reader", file: "reader.md" });
push({ kind: "critic", file: "critic.md" });
for (const slug of questions.concept ?? []) push({ kind: "concept-page", key: slug.toLowerCase(), file: `concept-${slugFile(slug)}.md` });
for (const f of ["conn-0", "conn-1", "tconn-0", "tconn-1", "tconn-2", "tsock-0", "tsock-1", "log-0"]) {
  const [short, n] = f.split("-");
  push({ kind: "hunk", key: `${short}:${n}`, file: `hunk-${f}.md` });
}
for (const k of godeeperKeys) push({ kind: "go-deeper", key: k, file: `go-deeper-${k}.md` });
for (const d of questions.depth ?? []) push({ kind: "depth", key: depthKey(d), file: depthFile(d) });
for (const x of extraFor("depth")) {
  if (!manifest.recordings.some((e) => e.kind === "depth" && e.key === x.key)) push({ kind: "depth", key: x.key, file: x.file });
}
for (const cardId of questions.examples ?? []) push({ kind: "examples", key: cardId, file: `examples-${cardId}.md` });
for (const cardId of questions.diagram ?? []) push({ kind: "diagram", key: cardId, file: `diagram-${cardId}.md` });
for (const e of questions.explain ?? []) {
  if (!["reused", "deduplicated"].includes(firedStatus(`explain:${e.key}`))) {
    push({ kind: "explain", key: e.key, pattern: explainPat(e), file: `explain-${e.key}.md` });
  }
}
for (const a of questions.ask ?? []) {
  if (!["reused", "deduplicated"].includes(firedStatus(`ask:${a.key}`))) {
    push({ kind: "ask", key: a.key, pattern: [a.quote, a.message].map((s) => esc(String(s).slice(0, 40))).join("|"), file: `ask-${a.key}.md` });
  }
}
for (const x of extraFor("ask")) {
  if (!manifest.recordings.some((e) => e.kind === "ask" && e.key === x.key)) {
    push({ kind: "ask", key: x.key, pattern: x.pattern, file: x.file });
  }
}
// New finding ids reuse the kept blind recordings (same issues, re-titled
// findings; same-model second opinions are refused by design).
for (const x of extraFor("second-opinion")) {
  if (!manifest.recordings.some((e) => e.kind === "second-opinion" && e.key === x.key)) {
    push({ kind: "second-opinion", key: x.key, file: x.file, recordedWith: x.recordedWith ?? "pre-341-fixture (model unrecorded)" });
  }
}
// Verify every extra file is already placed in recordings/ (copied by hand
// from the follow-up capture before --write; never guessed).
for (const x of extra) {
  if (!fs.existsSync(path.join(REC, x.file))) fail(`extraManifest ${x.kind}:${x.key ?? ""} missing recordings/${x.file} (copy it first)`);
}
// Second-opinion recordings are kept from the previous fixture (same-model
// second opinions are refused by design); per-entry provenance says so.
const oldManifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
for (const e of oldManifest.recordings ?? []) {
  if (e.kind === "second-opinion") {
    manifest.recordings.push({ ...e, recordedWith: "pre-341-fixture (model unrecorded)" });
  }
}

console.log(`curate: ${Object.keys(out).length} recordings, ${manifest.recordings.length} manifest entries`);
console.log(`curate: DRY RUN (no writes). Pass --write to copy files and rewrite manifest.json.`);
if (process.argv.includes("--write")) {
  for (const [dest, src] of Object.entries(out)) {
    fs.copyFileSync(src, path.join(REC, dest));
    console.log(`  wrote recordings/${dest}`);
  }
  const { createHash } = await import("node:crypto");
  const PROMPTS = path.join(ROOT, "prompts");
  const files = [];
  const collect = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) collect(full);
      else if (e.isFile()) files.push(full);
    }
  };
  collect(PROMPTS);
  files.sort();
  const hash = createHash("sha256");
  for (const full of files) {
    hash.update(path.relative(PROMPTS, full));
    hash.update("\0");
    hash.update(fs.readFileSync(full));
    hash.update("\0");
  }
  const doc = {
    recordedWith: { provider: "claude", model: "sonnet", label: "Sonnet 5.5" },
    promptHash: `sha256:${hash.digest("hex")}`,
    recordings: manifest.recordings,
  };
  fs.writeFileSync(path.join(FIX, "manifest.json"), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`  wrote manifest.json (${manifest.recordings.length} entries, promptHash ${doc.promptHash.slice(0, 19)}…)`);
}
