/**
 * Setup detection (issue #220): `unvibe start` never runs setup, but
 * prints a one-line hint when it has not run. Detection is pure file
 * checks under a fake HOME, simulated platforms.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSetupInstalled } from "../src/cli/setup/index.js";
import { helperAppPath } from "../src/cli/setup/macos.js";
import { desktopFilePath } from "../src/cli/setup/linux.js";
import { launchdPlistPath, systemdUnitPath } from "../src/cli/setup/login.js";

function fakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-setup-status-"));
}

function place(home: string, platform: "darwin" | "linux"): void {
  const handler = platform === "darwin" ? helperAppPath(home) : desktopFilePath(home);
  fs.mkdirSync(path.dirname(handler), { recursive: true });
  fs.writeFileSync(handler, "handler");
  const unit = platform === "darwin" ? launchdPlistPath(home) : systemdUnitPath(home);
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  fs.writeFileSync(unit, "unit");
}

describe("isSetupInstalled", () => {
  it("false when nothing is placed, true only when handler and unit exist", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const home = fakeHome();
      expect(isSetupInstalled(home, platform)).toBe(false);
      const handler = platform === "darwin" ? helperAppPath(home) : desktopFilePath(home);
      fs.mkdirSync(path.dirname(handler), { recursive: true });
      fs.writeFileSync(handler, "handler");
      expect(isSetupInstalled(home, platform)).toBe(false);
      place(home, platform);
      expect(isSetupInstalled(home, platform)).toBe(true);
    }
  });
});
