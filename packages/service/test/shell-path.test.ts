import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLoginShellPath,
  mergePaths,
  resolveLoginShellPath,
} from "../src/exec/shell-path.js";

function makeFakeShell(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

describe("mergePaths", () => {
  it("puts login entries first, appends unseen inherited ones, dedupes", () => {
    expect(mergePaths("/a:/b", "/b:/c")).toBe("/a:/b:/c");
    expect(mergePaths("", "/c")).toBe("/c");
    expect(mergePaths("/a", "")).toBe("/a");
    expect(mergePaths("", "")).toBe("");
  });
});

describe("resolveLoginShellPath", () => {
  it("uses $SHELL first (login+interactive with delimiters)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shell-"));
    const fake = makeFakeShell(dir, "myshell", "#!/bin/sh\necho /login/bin:/usr/bin\n");
    const prevShell = process.env.SHELL;
    const prevPath = process.env.PATH;
    process.env.SHELL = fake;
    process.env.PATH = "/usr/bin:/inherited";
    try {
      const found = await resolveLoginShellPath();
      expect(found?.shell).toBe(fake);
      expect(found?.loginPath).toBe("/login/bin:/usr/bin");
      // merged: login first, then the inherited extra.
      expect(found?.merged).toBe("/login/bin:/usr/bin:/inherited");
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
      process.env.PATH = prevPath;
    }
  });

  it("probes fish with login+interactive and delimiters", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shell-"));
    // A fake `fish` that records its argv, then prints a PATH.
    const argvFile = path.join(dir, "argv");
    const fake = makeFakeShell(
      dir,
      "fish",
      `#!/bin/sh\necho "$@" > ${argvFile}\necho /fish/path\n`,
    );
    const found = await resolveLoginShellPath({ shell: fake });
    expect(found?.loginPath).toBe("/fish/path");
    const argv = fs.readFileSync(argvFile, "utf8").trim();
    // Login + interactive with delimiters (robust to banners/garbage).
    expect(argv.startsWith("-l -i -c")).toBe(true);
    expect(argv).toContain("__UNVIBE_PATH_START__");
  });

  it("a hanging shell times out instead of hanging startup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shell-"));
    const slow = makeFakeShell(dir, "slowshell", "#!/bin/sh\nsleep 30\necho /slow\n");
    const start = Date.now();
    const found = await resolveLoginShellPath({ shell: slow, timeoutMs: 200 });
    const elapsed = Date.now() - start;
    // The 30s sleeper must not stall us; a fallback shell answers instead.
    expect(elapsed).toBeLessThan(15_000);
    expect(found === null || found.loginPath !== "/slow").toBe(true);
  });

  it("falls back to the next shell when the first fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shell-"));
    const failing = makeFakeShell(dir, "failsh", "#!/bin/sh\nexit 1\n");
    const good = makeFakeShell(dir, "goodsh", "#!/bin/sh\necho /good/bin\n");
    const prevShell = process.env.SHELL;
    process.env.SHELL = failing;
    try {
      // Explicit good shell answers directly.
      const found = await resolveLoginShellPath({ shell: good });
      expect(found?.loginPath).toBe("/good/bin");
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
    }
  });

  it("applyLoginShellPath sets process.env.PATH", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shell-"));
    const fake = makeFakeShell(dir, "applysh", "#!/bin/sh\necho /applied/bin\n");
    const prevPath = process.env.PATH;
    process.env.PATH = "/orig";
    try {
      const detail = await applyLoginShellPath({ shell: fake });
      expect(detail?.shell).toBe(fake);
      expect(process.env.PATH).toBe("/applied/bin:/orig");
      expect(detail?.before).toBe("/orig");
    } finally {
      process.env.PATH = prevPath;
    }
  });
});
