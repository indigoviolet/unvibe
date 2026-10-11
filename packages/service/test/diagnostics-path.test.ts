/**
 * PATH probing (issue #20): same answer however the process was started.
 *
 * Uses fake shells + rc files in temp HOMEs:
 * - tool only on the interactive PATH (rc adds it, inherited lacks it),
 * - rc file that prints garbage (delimiters filter it),
 * - rc file that hangs (timeout, fallback),
 * - scrubbed env (inherited PATH with good dirs does not leak into the probe).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildScrubbedEnv, probeEffectivePath, resolveInteractivePath } from "../src/diagnostics/path-probe.js";

function makeExecutable(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

describe("scrubbed interactive probe", () => {
  it("sees a tool only on the interactive PATH (rc adds it)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-home-"));
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-tool-"));
    // Fake login shell: reads $HOME/.zshrc effect by prepending toolDir when
    // HOME points at our temp HOME (simulates mise activation in .zshrc).
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fakebin-"));
    const fakeZsh = makeExecutable(
      binDir,
      "zsh",
      `#!/bin/sh\n# Simulate .zshrc adding the tool dir\nif [ -f "$HOME/.zshrc" ]; then . "$HOME/.zshrc" 2>/dev/null || true; fi\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${toolDir}:/usr/bin:/bin"\n`,
    );
    fs.writeFileSync(path.join(home, ".zshrc"), `export PATH="${toolDir}:$PATH"\n`);
    const scrub = buildScrubbedEnv({ home, shell: fakeZsh });
    // Scrubbed env must not contain the tool dir via inherited PATH.
    expect(scrub.PATH).not.toContain(toolDir);
    const found = await resolveInteractivePath({
      candidates: [fakeZsh],
      scrubEnv: scrub,
      timeoutMs: 3000,
    });
    expect(found?.probedPath).toContain(toolDir);
  });

  it("filters rc garbage via delimiters", async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fakebin-"));
    const fake = makeExecutable(
      binDir,
      "garbage-sh",
      '#!/bin/sh\necho "Welcome! oh-my-zsh banner"\necho "set -u noise"\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "/garbage/bin:/usr/bin"\necho "more prompt junk"\n',
    );
    const found = await resolveInteractivePath({ candidates: [fake], timeoutMs: 3000 });
    expect(found?.probedPath).toBe("/garbage/bin:/usr/bin");
  });

  it("times out on a hanging rc file and falls back", async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fakebin-"));
    const slow = makeExecutable(binDir, "slowsh", "#!/bin/sh\nsleep 30\necho /slow\n");
    const good = makeExecutable(binDir, "goodsh", '#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "/good/bin"\n');
    const start = Date.now();
    const found = await resolveInteractivePath({ candidates: [slow, good], timeoutMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
    expect(found?.probedPath).toBe("/good/bin");
  });

  it("does not depend on inherited env that happens to contain the right dirs", async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fakebin-"));
    const toolDir = "/only-inherited-xyz";
    const fake = makeExecutable(
      binDir,
      "scrubsh",
      '#!/bin/sh\n# Probe must run from scrubbed env: inherited toolDir must NOT appear unless rc adds it.\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "/usr/bin:/bin"\n',
    );
    const prevPath = process.env.PATH;
    process.env.PATH = `${toolDir}:${prevPath}`;
    try {
      const probed = await probeEffectivePath({
        candidates: [fake],
        timeoutMs: 3000,
        inheritedPath: process.env.PATH,
      });
      // Probed PATH comes from the shell, not inherited.
      expect(probed?.probedPath).not.toContain(toolDir);
      // Effective merges inherited extras (reported, not hidden).
      expect(probed?.effectivePath).toContain(toolDir);
      expect(probed?.onlyInInherited).toContain(toolDir);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("reports shell, PATHs and diffs", async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-fakebin-"));
    const fake = makeExecutable(
      binDir,
      "diffsh",
      '#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "/a:/b"\n',
    );
    const probed = await probeEffectivePath({ candidates: [fake], inheritedPath: "/b:/c", timeoutMs: 3000 });
    expect(probed?.shell).toBe(fake);
    expect(probed?.probedPath).toBe("/a:/b");
    expect(probed?.effectivePath).toBe("/a:/b:/c");
    expect(probed?.onlyInProbed).toEqual(["/a"]);
    expect(probed?.onlyInInherited).toEqual(["/c"]);
  });
});
