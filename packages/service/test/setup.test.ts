import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appleScriptSource,
  helperAppPath,
  patchInfoPlist,
} from "../src/cli/setup/macos.js";
import {
  desktopFileContent,
  desktopFilePath,
  DESKTOP_FILENAME,
} from "../src/cli/setup/linux.js";
import {
  installSetup,
  setupAllowedRoots,
  uninstallSetup,
  type RunResult,
  type SetupRunner,
} from "../src/cli/setup/index.js";

const NODE_PATH = "/opt/homebrew/bin/node";
const CLI_PATH = "/opt/homebrew/lib/node_modules/unvibe/packages/service/dist/index.js";
const SPACY_NODE = "/Users/test/My Tools/node";
const SPACY_CLI = "/Users/test/My Tools/unvibe cli/dist/index.js";

// Representative osacompile-generated Info.plist (structure, not Apple's bytes).
const SAMPLE_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "  <key>CFBundleIdentifier</key>",
  "  <string>com.apple.ScriptEditor.id.Unvibe-Helper</string>",
  "  <key>CFBundleName</key>",
  "  <string>Unvibe</string>",
  "</dict>",
  "</plist>",
  "",
].join("\n");

describe("macOS helper generation", () => {
  it("AppleScript handles unvibe://start with absolute paths", () => {
    expect(appleScriptSource(NODE_PATH, CLI_PATH)).toMatchSnapshot();
  });

  it("paths with spaces are shell-quoted inside the AppleScript string", () => {
    const src = appleScriptSource(SPACY_NODE, SPACY_CLI);
    expect(src).toMatchSnapshot();
    // The shell must see two words, not four: single-quoted in sh.
    expect(src).toContain(`'/Users/test/My Tools/node' '/Users/test/My Tools/unvibe cli/dist/index.js' start`);
  });

  it("Info.plist patch registers the unvibe:// scheme", () => {
    expect(patchInfoPlist(SAMPLE_PLIST)).toMatchSnapshot();
  });

  it("patch keeps the plist well-formed (one top-level dict, scheme present)", () => {
    const patched = patchInfoPlist(SAMPLE_PLIST);
    expect(patched).toContain("<key>CFBundleURLTypes</key>");
    expect(patched).toContain("<string>unvibe</string>");
    expect(patched.match(/<dict>/g)?.length).toBe(patched.match(/<\/dict>/g)?.length);
    expect(() => patchInfoPlist("<plist/>")).toThrow();
  });

  it("helper lives in ~/Applications", () => {
    expect(helperAppPath("/Users/test")).toBe("/Users/test/Applications/Unvibe.app");
  });
});

describe("Linux desktop handler generation", () => {
  it("desktop file contents", () => {
    expect(desktopFileContent("/usr/bin/node", "/usr/lib/node_modules/unvibe/dist/index.js")).toMatchSnapshot();
  });

  it("paths with spaces are quoted", () => {
    const content = desktopFileContent("/home/u/My Tools/node", "/home/u/My Tools/cli.js");
    expect(content).toMatchSnapshot();
    expect(content).toContain('Exec="/home/u/My Tools/node" "/home/u/My Tools/cli.js" start %u');
  });

  it("registers the scheme MIME type, hidden from menus", () => {
    const content = desktopFileContent("/usr/bin/node", "/x/cli.js");
    expect(content).toContain("MimeType=x-scheme-handler/unvibe;");
    expect(content).toContain("NoDisplay=true");
  });

  it("desktop file lives in ~/.local/share/applications", () => {
    expect(desktopFilePath("/home/u")).toBe(`/home/u/.local/share/applications/${DESKTOP_FILENAME}`);
  });
});

/** Stub runner: records calls; fakes osacompile by writing a bundle skeleton. */
function stubRunner(appPlist = SAMPLE_PLIST): SetupRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async (cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "osacompile") {
        const out = args[args.indexOf("-o") + 1];
        fs.mkdirSync(path.join(out, "Contents"), { recursive: true });
        fs.writeFileSync(path.join(out, "Contents", "Info.plist"), appPlist);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function fakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-home-"));
}

const PATHS = (home: string) => ({ homeDir: home, nodePath: "/usr/bin/node", cliPath: "/x/cli.js" });

describe("setup orchestration", () => {
  it("mac install compiles, patches the plist, registers; rerun is idempotent", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    const first = await installSetup(PATHS(home), runner, "darwin");
    expect(first.join("\n")).toContain("Applications/Unvibe.app");
    const plist = fs.readFileSync(path.join(home, "Applications/Unvibe.app/Contents/Info.plist"), "utf8");
    expect(plist).toContain("<string>unvibe</string>");
    expect(runner.calls.some((c) => c.startsWith("osacompile"))).toBe(true);
    expect(runner.calls.some((c) => c.includes("lsregister -f"))).toBe(true);

    const callsBefore = runner.calls.length;
    const second = await installSetup(PATHS(home), runner, "darwin");
    expect(second.length).toBe(first.length);
    expect(runner.calls.length).toBeGreaterThan(callsBefore);
    // Same content: deterministic output.
    expect(fs.readFileSync(path.join(home, "Applications/Unvibe.app/Contents/Info.plist"), "utf8")).toBe(plist);
  });

  it("mac uninstall removes the app; rerun is a no-op", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    await installSetup(PATHS(home), runner, "darwin");
    const steps = await uninstallSetup(PATHS(home), runner, "darwin");
    expect(steps.join("\n")).toContain("removed");
    expect(fs.existsSync(path.join(home, "Applications/Unvibe.app"))).toBe(false);
    const again = await uninstallSetup(PATHS(home), runner, "darwin");
    expect(again.join("\n")).toContain("nothing to remove");
  });

  it("linux install writes the desktop file and registers the MIME type", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    const steps = await installSetup(PATHS(home), runner, "linux");
    const file = desktopFilePath(home);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(desktopFileContent("/usr/bin/node", "/x/cli.js"));
    expect(runner.calls).toContain(`xdg-mime default ${DESKTOP_FILENAME} x-scheme-handler/unvibe`);
    expect(steps.join("\n")).toContain(file);

    const again = await installSetup(PATHS(home), runner, "linux");
    expect(again.length).toBe(steps.length);

    const removed = await uninstallSetup(PATHS(home), runner, "linux");
    expect(removed.join("\n")).toContain("removed");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("writes nothing outside its allow-listed roots (no login items)", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const home = fakeHome();
      // Seed the login-item locations so we can tell setup didn't touch them.
      const loginItemDirs = [
        "Library/LaunchAgents",
        ".config/autostart",
        ".config/systemd/user",
      ].map((d) => path.join(home, d));
      for (const d of loginItemDirs) fs.mkdirSync(d, { recursive: true });

      await installSetup(PATHS(home), stubRunner(), platform);

      const seen: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else seen.push(full);
        }
      };
      walk(home);
      const allowed = setupAllowedRoots(home, platform);
      for (const f of seen) {
        const underAllowed = allowed.some((a) => f === a || f.startsWith(a + path.sep));
        expect(underAllowed, `${platform}: setup wrote unexpected file ${f}`).toBe(true);
      }
      // And specifically: nothing unvibe-related in login-item locations.
      for (const d of loginItemDirs) {
        expect(fs.readdirSync(d), `${platform}: login-item dir ${d} touched`).toEqual([]);
      }
    }
  });

  it("osacompile failure surfaces a clear error", async () => {
    const home = fakeHome();
    const failing: SetupRunner = {
      run: async () => ({ code: 1, stdout: "", stderr: "applescript error" }),
    };
    await expect(installSetup(PATHS(home), failing, "darwin")).rejects.toThrow("osacompile failed");
  });
});
