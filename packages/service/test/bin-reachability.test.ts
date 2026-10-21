/**
 * Bin reachability (issue #42): with mise-managed Node the global bin
 * can land in one Node version's prefix, off the interactive PATH, so
 * npm reports success while a fresh terminal cannot run `unvibe`.
 * Pure assessment with injected PATH dirs and existence.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { assessBinReachability, binReachabilityAdvice, prefixBinDirForCli } from "../src/cli/setup/bin-reachability.js";

const HOME = path.join(path.sep, "home", "user");
const PREFIX = path.join(HOME, ".local", "share", "mise", "installs", "node", "26.11.1");
const CLI = path.join(PREFIX, "lib", "node_modules", "unvibe", "packages", "service", "dist", "index.js");
const BIN_DIR = path.join(PREFIX, "bin");
const SHIMS = path.join(HOME, ".local", "share", "mise", "shims");

const none = () => false;

describe("prefixBinDirForCli", () => {
  it("derives <prefix>/bin from the installed layout", () => {
    expect(prefixBinDirForCli(CLI)).toBe(BIN_DIR);
  });

  it("returns null outside the installed layout", () => {
    expect(prefixBinDirForCli(path.join(path.sep, "repo", "packages", "service", "dist", "index.js"))).toBeNull();
  });
});

describe("assessBinReachability", () => {
  it("reachable when the prefix bin dir is on the interactive PATH", () => {
    const r = assessBinReachability({ cliPath: CLI, homeDir: HOME, interactivePathDirs: ["/usr/bin", BIN_DIR], exists: none });
    expect(r.installedLayout).toBe(true);
    expect(r.reachable).toBe(true);
    expect(r.via).toBe("prefix-bin");
    expect(binReachabilityAdvice(r)).toEqual([]);
  });

  it("reachable via the mise shims dir when the shim exists", () => {
    const r = assessBinReachability({
      cliPath: CLI,
      homeDir: HOME,
      interactivePathDirs: [SHIMS, "/usr/bin"],
      exists: (p) => p === path.join(SHIMS, "unvibe"),
    });
    expect(r.reachable).toBe(true);
    expect(r.via).toBe("mise-shims");
  });

  it("not reachable via shims when no shim was created yet (no reshim)", () => {
    const r = assessBinReachability({ cliPath: CLI, homeDir: HOME, interactivePathDirs: [SHIMS, "/usr/bin"], exists: none });
    expect(r.reachable).toBe(false);
    expect(r.via).toBeNull();
  });

  it("reachable when another PATH dir holds an unvibe bin", () => {
    const localBin = path.join(HOME, ".local", "bin");
    const r = assessBinReachability({
      cliPath: CLI,
      homeDir: HOME,
      interactivePathDirs: [localBin],
      exists: (p) => p === path.join(localBin, "unvibe"),
    });
    expect(r.reachable).toBe(true);
    expect(r.via).toBe("path");
  });

  it("unreachable: advice names the prefix bin dir, mise reshim + shims, and the symlink fix", () => {
    const r = assessBinReachability({ cliPath: CLI, homeDir: HOME, interactivePathDirs: ["/usr/bin", "/bin"], exists: none });
    expect(r.reachable).toBe(false);
    const advice = binReachabilityAdvice(r).join("\n");
    expect(advice).toContain(BIN_DIR);
    expect(advice).toContain("mise reshim");
    expect(advice).toContain(SHIMS);
    expect(advice).toContain(`ln -s ${path.join(BIN_DIR, "unvibe")} ~/.local/bin/unvibe`);
  });

  it("reachable when PATH spells the prefix /private/var but the install is under /var (macOS)", () => {
    const varHome = path.join(path.sep, "var", "home", "user");
    const varPrefix = path.join(varHome, ".local", "share", "mise", "installs", "node", "26.11.1");
    const r = assessBinReachability({
      cliPath: path.join(varPrefix, "lib", "node_modules", "unvibe", "packages", "service", "dist", "index.js"),
      homeDir: varHome,
      interactivePathDirs: [path.join(path.sep, "private", "var", "home", "user", ".local", "share", "mise", "installs", "node", "26.11.1", "bin")],
      exists: none,
      canonicalize: (p) => p.replace(/^\/private\/var\//, "/var/"),
    });
    expect(r.reachable).toBe(true);
    expect(r.via).toBe("prefix-bin");
  });

  it("dev layout: not an installed install, no advice", () => {
    const r = assessBinReachability({
      cliPath: path.join(path.sep, "repo", "packages", "service", "dist", "index.js"),
      homeDir: HOME,
      interactivePathDirs: ["/usr/bin"],
      exists: none,
    });
    expect(r.installedLayout).toBe(false);
    expect(binReachabilityAdvice(r)).toEqual([]);
  });
});
