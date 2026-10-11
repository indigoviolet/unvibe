/**
 * Failure-mode probes for the d2 binary (service defence design).
 * Hand-written hostile/edge inputs; each prints what the binary does.
 *
 * Usage: node src/linkprobe.mjs
 * Env: D2_BIN (default: resolved from `mise x d2@latest -- which d2`).
 * Writes: out/probe/*.log + secrets kept under /tmp/opencode/d2probe/.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const OUT = "out/probe";
fs.mkdirSync(OUT, { recursive: true });
const SECRETDIR = path.join("/tmp", "opencode", "d2probe");
fs.mkdirSync(SECRETDIR, { recursive: true });

let D2_BIN = process.env.D2_BIN;
if (!D2_BIN) {
  D2_BIN = execFileSync("mise", ["x", "d2@latest", "--", "which", "d2"], { encoding: "utf8" }).trim().split("\n").pop().trim();
}
console.log(`d2: ${D2_BIN} ${execFileSync(D2_BIN, ["version"], { encoding: "utf8" }).trim()}`);

function runD2(input, { args = [], timeoutMs = 20000, env = {}, stdinBytes = null } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(D2_BIN, [...args, "-", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let out = Buffer.alloc(0);
    let err = "";
    let timedOut = false;
    const kill = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => { out = Buffer.concat([out, d]); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code, signal) => {
      clearTimeout(kill);
      resolve({ code, signal, timedOut, svg: out, text: out.toString("utf8"), stderr: err.slice(0, 500), ms: Date.now() - t0 });
    });
    child.on("error", (e) => { clearTimeout(kill); resolve({ code: -1, timedOut: false, svg: Buffer.alloc(0), text: "", stderr: String(e).slice(0, 300), ms: Date.now() - t0 }); });
    child.stdin.write(stdinBytes ?? Buffer.from(input, "utf8"));
    child.stdin.end();
  });
}

const log = [];
function say(s) { log.push(s); console.log(s); }

// --- probe 1: icon URL — does the binary fetch the network? ---
{
  say("\n== 1. icon: URL (network?) ==");
  let hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "image/png" });
    // 1x1 transparent PNG
    res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const src = `direction: right\na: Foo {\n  icon: http://127.0.0.1:${port}/icon.png\n}\nb: Bar\na -> b\n`;
  const r = await runD2(src, { timeoutMs: 20000 });
  say(`exit=${r.code} ms=${r.ms} svgBytes=${r.svg.length} serverHits=${hits.length} ${hits.join(";") || "(none)"}`);
  say(`svg has <image:${r.text.includes("<image")} externalRef:${/xlink:href="http|:href="http/.test(r.text)} dataURI:${r.text.includes("data:image")}`);
  fs.writeFileSync(`${OUT}/icon.svg`, r.text);
  // And an unroutable remote: bogus proxy env (unshare -n unavailable in this env).
  const r2 = await runD2(
    `direction: right\na: Foo {\n  icon: https://example.invalid/x.png\n}\n`,
    { timeoutMs: 25000, env: { HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9" } },
  );
  say(`remote-icon exit=${r2.code} ms=${r2.ms} svgBytes=${r2.svg.length} err=${r2.stderr.slice(0, 160)}`);
  srv.close();
}

// --- probe 2: import of a local file — does it read outside stdin? ---
{
  say("\n== 2. import local file (fs read?) ==");
  const secret = path.join(SECRETDIR, "secret.d2");
  fs.writeFileSync(secret, `SECRET_SHOULD_NOT_APPEAR: "leaked"\n`);
  const variants = {
    "spread-import": `direction: right\na: Foo\n...@${secret}\n`,
    "at-value": `direction: right\na: Foo\nb: @${secret}\n`,
  };
  for (const [name, src] of Object.entries(variants)) {
    const r = await runD2(src, { timeoutMs: 20000 });
    say(`${name}: exit=${r.code} ms=${r.ms} leaked=${r.text.includes("SECRET_SHOULD_NOT_APPEAR")} err=${r.stderr.slice(0, 160)}`);
    fs.writeFileSync(`${OUT}/import-${name}.log`, `src:\n${src}\nexit=${r.code}\nstderr:\n${r.stderr}\nleaked=${r.text.includes("SECRET_SHOULD_NOT_APPEAR")}\n`);
  }
}

// --- probe 3: markdown label — foreignObject/HTML in SVG? ---
{
  say("\n== 3. markdown label (|md) ==");
  const src = `direction: right\na: |md\n# Hello\n**bold** [x](https://example.com)\n|\nb: Plain\na -> b\n`;
  const r = await runD2(src, { timeoutMs: 20000 });
  say(`exit=${r.code} ms=${r.ms} svgBytes=${r.svg.length} foreignObject=${(r.text.match(/<foreignObject/g) || []).length} scriptTag=${r.text.includes("<script")} onclick=${/on\w+=/.test(r.text)}`);
  fs.writeFileSync(`${OUT}/md.svg`, r.text);
}

// --- probe 4: link: javascript: — passthrough? ---
{
  say("\n== 4. link: javascript: ==");
  for (const payload of [`javascript:alert(1)`, `JaVaScRiPt:alert(1)`, `data:text/html,<script>alert(1)</script>`]) {
    const src = `direction: right\na: Foo {\n  link: "${payload}"\n}\n`;
    const r = await runD2(src, { timeoutMs: 20000 });
    const hrefs = [...r.text.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith("#"));
    say(`payload=${payload.slice(0, 28)} exit=${r.code} hrefs=${JSON.stringify(hrefs).slice(0, 120)}`);
  }
}

// --- probe 5: oversized diagram (time; /usr/bin/time for peak RSS) ---
{
  say("\n== 5. oversized diagram ==");
  for (const n of [500, 5000]) {
    let parts = ["direction: right"];
    for (let i = 0; i < n; i++) parts.push(`n${i}: "Node ${i}"`);
    parts.push(Array.from({ length: n - 1 }, (_, i) => `n${i} -> n${i + 1}`).join("\n"));
    const src = parts.join("\n") + "\n";
    const f = `${OUT}/big-${n}.d2`;
    fs.writeFileSync(f, src);
    const t0 = Date.now();
    let rss = "n/a";
    try {
      const out = execFileSync("/usr/bin/time", ["-v", D2_BIN, f, `${OUT}/big-${n}.svg`], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
      void out;
    } catch (e) {
      const m = String(e.stderr || "").match(/Maximum resident set size \(kbytes\): (\d+)/);
      if (m) rss = `${(Number(m[1]) / 1024).toFixed(1)} MB`;
      say(`n=${n}: TIMEOUT-or-err after ${Date.now() - t0}ms rss=${rss} status=${e.status}`);
      continue;
    }
    say(`n=${n}: srcBytes=${src.length} wallMs=${Date.now() - t0} (see time -v below)`);
  }
}

// --- probe 6: invalid UTF-8 on stdin ---
{
  say("\n== 6. invalid UTF-8 ==");
  const bad = Buffer.concat([Buffer.from("direction: right\na: Foo \xff\xfe bar\n", "latin1"), Buffer.from([0x80, 0x81, 0xfe]), Buffer.from("\na -> a\n")]);
  const r = await runD2("", { stdinBytes: bad, timeoutMs: 20000 });
  say(`exit=${r.code} ms=${r.ms} svgBytes=${r.svg.length} err=${r.stderr.slice(0, 200)}`);
}

// --- probe 7: 1 MB input ---
{
  say("\n== 7. 1 MB input ==");
  let parts = ["direction: right"];
  let i = 0;
  while (Buffer.byteLength(parts.join("\n")) < 1024 * 1024) { parts.push(`m${i}: "Padded node number ${i} lorem ipsum dolor sit amet"\nm${i} -> m${Math.max(0, i - 1)}`); i++; }
  const src = parts.join("\n") + "\n";
  fs.writeFileSync(`${OUT}/one-mb.d2`, src);
  say(`srcBytes=${src.length} shapes~${i}`);
  const r = await runD2(src, { timeoutMs: 60000 });
  say(`exit=${r.code} ms=${r.ms} svgBytes=${r.svg.length} err=${r.stderr.slice(0, 200)}`);
}

fs.writeFileSync(`${OUT}/probe.log`, log.join("\n") + "\n");
say("\nprobe log written.");
