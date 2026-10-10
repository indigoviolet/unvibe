import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVICE_SRC = new URL("../src/", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("ACP import isolation", () => {
  it("nothing outside src/agent/acp/ imports @agentclientprotocol/*", () => {
    const offenders: string[] = [];
    for (const f of walk(SERVICE_SRC)) {
      if (f.includes("/agent/acp/")) continue;
      const src = readFileSync(f, "utf8");
      if (/(?:from\s+["']|import\s*\(\s*["'])@agentclientprotocol\//.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
