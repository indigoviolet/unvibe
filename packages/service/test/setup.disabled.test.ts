// DISABLED(#188): pins setup/login-unit exact contents (shell e2e covers behaviour)
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
  LAUNCHD_LABEL,
  launchdPlistContent,
  launchdPlistPath,
  SYSTEMD_UNIT_NAME,
  systemdEnv,
  systemdQuote,
  systemdUnitContent,
  systemdUnitPath,
} from "../src/cli/setup/login.js";
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
const OPTS = (home: string) => ({ port: 4517, dataDir: path.join(home, ".local", "share", "unvibe") });

describe("setup orchestration", () => {
  it("mac install compiles, patches the plist, registers; rerun is idempotent", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    const first = await installSetup(PATHS(home), runner, "darwin", OPTS(home));
    expect(first.join("\n")).toContain("Applications/Unvibe.app");
    const plist = fs.readFileSync(path.join(home, "Applications/Unvibe.app/Contents/Info.plist"), "utf8");
    expect(plist).toContain("<string>unvibe</string>");
    expect(runner.calls.some((c) => c.startsWith("osacompile"))).toBe(true);
    expect(runner.calls.some((c) => c.includes("lsregister -f"))).toBe(true);
    // Start-at-login agent installed and enabled (#108).
    expect(first.join("\n")).toContain("starts at login");
    expect(runner.calls.some((c) => c.includes("launchctl bootstrap"))).toBe(true);

    const callsBefore = runner.calls.length;
    const second = await installSetup(PATHS(home), runner, "darwin", OPTS(home));
    expect(second.length).toBe(first.length);
    expect(runner.calls.length).toBeGreaterThan(callsBefore);
    // Same content: deterministic output.
    expect(fs.readFileSync(path.join(home, "Applications/Unvibe.app/Contents/Info.plist"), "utf8")).toBe(plist);
  });

  it("mac uninstall removes the app and the login agent; rerun is a no-op", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    await installSetup(PATHS(home), runner, "darwin", OPTS(home));
    const steps = await uninstallSetup(PATHS(home), runner, "darwin");
    expect(steps.join("\n")).toContain("removed");
    expect(fs.existsSync(path.join(home, "Applications/Unvibe.app"))).toBe(false);
    expect(fs.existsSync(launchdPlistPath(home))).toBe(false);
    expect(runner.calls.some((c) => c.includes(`launchctl bootout gui/`) && c.includes(LAUNCHD_LABEL))).toBe(true);
    const again = await uninstallSetup(PATHS(home), runner, "darwin");
    expect(again.join("\n")).toContain("nothing to remove");
  });

  it("linux install writes the desktop file and registers the MIME type", async () => {
    const home = fakeHome();
    const runner = stubRunner();
    const steps = await installSetup(PATHS(home), runner, "linux", OPTS(home));
    const file = desktopFilePath(home);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(desktopFileContent("/usr/bin/node", "/x/cli.js"));
    expect(runner.calls).toContain(`xdg-mime default ${DESKTOP_FILENAME} x-scheme-handler/unvibe`);
    expect(steps.join("\n")).toContain(file);
    // Start-at-login unit installed and enabled (#108).
    expect(steps.join("\n")).toContain("starts at login");
    expect(runner.calls).toContain(`systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`);

    const again = await installSetup(PATHS(home), runner, "linux", OPTS(home));
    expect(again.length).toBe(steps.length);

    const removed = await uninstallSetup(PATHS(home), runner, "linux");
    expect(removed.join("\n")).toContain("removed");
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(systemdUnitPath(home))).toBe(false);
  });

  it("writes only its allow-listed roots: handler plus the login unit", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const home = fakeHome();
      await installSetup(PATHS(home), stubRunner(), platform, OPTS(home));

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
      // And specifically: the login unit is exactly where it belongs.
      const loginFile = platform === "darwin" ? launchdPlistPath(home) : systemdUnitPath(home);
      expect(fs.existsSync(loginFile), `${platform}: login unit written`).toBe(true);
    }
  });

  it("--no-login skips the login unit (handler only, as before #108)", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const home = fakeHome();
      const runner = stubRunner();
      const steps = await installSetup(PATHS(home), runner, platform, { ...OPTS(home), noLogin: true });
      expect(steps.join("\n")).toContain("--no-login");
      expect(fs.existsSync(platform === "darwin" ? launchdPlistPath(home) : systemdUnitPath(home))).toBe(false);
      expect(runner.calls.some((c) => c.includes("launchctl bootstrap") || c.includes("systemctl --user enable"))).toBe(
        false,
      );
    }
  });

  it("login enable failure still installs, with a warning naming the manual command", async () => {
    const home = fakeHome();
    const failing: SetupRunner = {
      run: async (cmd: string) =>
        cmd === "systemctl" || cmd === "launchctl"
          ? { code: 1, stdout: "", stderr: "no session" }
          : { code: 0, stdout: "", stderr: "" },
    };
    const steps = await installSetup(PATHS(home), failing, "linux", OPTS(home));
    expect(fs.existsSync(systemdUnitPath(home))).toBe(true);
    expect(steps.join("\n")).toContain("warning: login start not enabled");
    expect(steps.join("\n")).toContain("systemctl --user enable --now");
  });

  it("osacompile failure surfaces a clear error", async () => {
    const home = fakeHome();
    const failing: SetupRunner = {
      run: async () => ({ code: 1, stdout: "", stderr: "applescript error" }),
    };
    await expect(installSetup(PATHS(home), failing, "darwin", OPTS(home))).rejects.toThrow("osacompile failed");
  });
});

describe("start-at-login units (#108)", () => {
  const UNIT = { nodePath: "/usr/bin/node", cliPath: "/x/cli.js", port: 4517, dataDir: "/home/u/.local/share/unvibe" };

  it("launchd plist runs the CLI at load, kept alive, never idle-exits", () => {
    expect(launchdPlistPath("/Users/test")).toBe("/Users/test/Library/LaunchAgents/com.unvibe.service.plist");
    const content = launchdPlistContent(UNIT);
    expect(content).toMatchSnapshot();
    expect(content).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(content).toContain("<string>start</string>");
    expect(content).toContain("<string>--foreground</string>");
    expect(content).toContain("<key>RunAtLoad</key>");
    expect(content).toContain("<key>KeepAlive</key>");
    expect(content).toContain("<string>4517</string>");
    expect(content).toContain("<string>/home/u/.local/share/unvibe</string>");
    expect(content).toContain("<key>UNVIBE_IDLE_MS</key>");
    expect(content).toContain("<string>0</string>");
    expect(content).not.toContain("GITHUB_TOKEN");
  });

  it("launchd plist escapes XML in paths", () => {
    const content = launchdPlistContent({ ...UNIT, dataDir: "/home/u/a&b/<c>" });
    expect(content).toContain("/home/u/a&amp;b/&lt;c&gt;");
  });

  it("systemd unit starts at login, restarts, never idle-exits", () => {
    expect(systemdUnitPath("/home/u")).toBe("/home/u/.config/systemd/user/unvibe.service");
    const content = systemdUnitContent(UNIT);
    expect(content).toMatchSnapshot();
    expect(content).toContain("ExecStart=/usr/bin/node /x/cli.js start --foreground");
    expect(content).toContain("Environment=UNVIBE_PORT=4517");
    expect(content).toContain("Environment=UNVIBE_DATA_DIR=/home/u/.local/share/unvibe");
    expect(content).toContain("Environment=UNVIBE_IDLE_MS=0");
    expect(content).toContain("WantedBy=default.target");
    expect(content).toContain("Restart=on-failure");
    expect(content).not.toContain("GITHUB_TOKEN");
  });

  it("systemd quoting handles spaces", () => {
    expect(systemdQuote("/usr/bin/node")).toBe("/usr/bin/node");
    expect(systemdQuote("/home/u/My Tools/node")).toBe('"/home/u/My Tools/node"');
    expect(systemdEnv("UNVIBE_PORT", "4517")).toBe("Environment=UNVIBE_PORT=4517");
    expect(systemdEnv("UNVIBE_DATA_DIR", "/home/u/My Data")).toBe('Environment="UNVIBE_DATA_DIR=/home/u/My Data"');
    const content = systemdUnitContent({ ...UNIT, nodePath: "/home/u/My Tools/node", dataDir: "/home/u/My Data" });
    expect(content).toContain('ExecStart="/home/u/My Tools/node" /x/cli.js start --foreground');
    expect(content).toContain('Environment="UNVIBE_DATA_DIR=/home/u/My Data"');
  });
});
