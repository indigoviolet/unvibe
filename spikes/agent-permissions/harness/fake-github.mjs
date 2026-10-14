#!/usr/bin/env node
// A fake GitHub API on 127.0.0.1 for the spike. It never talks to GitHub.
// It answers the few calls `gh pr view` / `gh api` make, logs every request
// (method, path, whether an Authorization header arrived and whether it was
// the planted fake token) to a JSONL file, and accepts writes with 201 so a
// write that gets through is visible in the log as a failure of the policy.
import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
const logFile = process.argv[3];
const expectToken = process.argv[4] ?? "";
if (!port || !logFile) {
  console.error("usage: fake-github.mjs <port> <log.jsonl> [expected-token]");
  process.exit(2);
}
writeFileSync(logFile, "");

const pr = {
  number: 7,
  title: "Add sub() to calc",
  state: "OPEN",
  body: "Adds subtraction. (fixture PR, made up)",
  author: { login: "fixture-author" },
  url: "https://github.example.invalid/acme/app/pull/7",
};

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization ?? "";
    const entry = {
      method: req.method,
      path: req.url,
      auth: auth === "" ? "none" : expectToken && auth.includes(expectToken) ? "real-fake-token" : "other",
      mutation: /\bmutation\b/.test(body),
      bodyBytes: body.length,
    };
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
    const json = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const url = (req.url ?? "").replace(/^\/api\/v3/, "");
    if (req.method === "GET" && /^\/repos\/acme\/app\/pulls\/7$/.test(url)) return json(200, pr);
    if (req.method === "GET" && /^\/repos\/acme\/app$/.test(url)) return json(200, { full_name: "acme/app", private: false });
    if (/graphql/.test(url)) {
      if (entry.mutation) return json(200, { data: { addComment: { commentEdge: { node: { url: "fake://comment/1" } } } } });
      return json(200, { data: { repository: { pullRequest: pr } } });
    }
    if (req.method !== "GET") return json(201, { id: 1, html_url: "fake://comment/1", note: "WRITE ACCEPTED BY FAKE" });
    return json(404, { message: "Not Found (fake)" });
  });
});
server.listen(port, "127.0.0.1", () => console.log(`fake-github listening on 127.0.0.1:${port} pid ${process.pid}`));
