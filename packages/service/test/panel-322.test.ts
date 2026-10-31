/**
 * #322 part 2 PILOT (1–2 cases, run before building the panel further):
 * case 1 — a question whose terms live in two different active repos
 * must read BOTH worktrees and cite BOTH with repo-qualified citations.
 * case 2 — lockdown: a path escaping a worktree is refused, and a repo
 * with no matching term is not claimed as used.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRepoCodeCitation } from "@unvibe/shared";
import { assertInsideRepo, retrieveAcrossRepos } from "../src/panel/retriever.js";

function repo(owner: string, name: string, files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `unvibe-pilot-${name}-`));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return { id: name, owner, name, localPath: dir };
}

describe("#322 pilot: multi-repo selection", () => {
  it("case 1: reads both repos and cites both, repo-qualified", () => {
    const service = repo("acme", "service", { "src/auth.ts": "export function validateToken(t: string) { return t.length > 3; }\n" });
    const client = repo("acme", "client", { "src/api.ts": "export async function fetchSession() { return validateTokenClient(); }\n" });
    try {
      const r = retrieveAcrossRepos([service, client], "How does validateToken work with fetchSession?");
      expect(r.reposUsed).toEqual(["acme/service", "acme/client"]);
      expect(r.reads.map((x) => x.slug)).toContain("acme/service");
      expect(r.reads.map((x) => x.slug)).toContain("acme/client");
      expect(r.citations.length).toBeGreaterThanOrEqual(2);
      for (const c of r.citations) expect(parseRepoCodeCitation(c)).not.toBeNull();
      expect(r.citations.some((c) => c.startsWith("code:acme/service:"))).toBe(true);
      expect(r.citations.some((c) => c.startsWith("code:acme/client:"))).toBe(true);
      expect(r.answer).toContain("acme/service");
      expect(r.answer).toContain("acme/client");
    } finally { rmSync(service.localPath, { recursive: true, force: true }); rmSync(client.localPath, { recursive: true, force: true }); }
  });

  it("case 2: lockdown refuses escapes; unmatched repo is not 'used'", () => {
    const a = repo("acme", "service", { "src/a.ts": "export const alphaToken = 1;\n" });
    const b = repo("acme", "other", { "src/b.ts": "export const unrelated = 2;\n" });
    try {
      expect(() => assertInsideRepo(a.localPath, "/etc/passwd")).toThrow(/outside/);
      const r = retrieveAcrossRepos([a, b], "Where is alphaToken?");
      expect(r.reposUsed).toEqual(["acme/service"]);
    } finally { rmSync(a.localPath, { recursive: true, force: true }); rmSync(b.localPath, { recursive: true, force: true }); }
  });
});
