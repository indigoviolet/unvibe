/**
 * Whether the installed `unvibe` bin is runnable by name from a fresh
 * interactive shell (owner's Mac, #42 follow-up): with mise-managed Node
 * the global bin lands in one Node version's prefix (`<prefix>/bin`),
 * which reaches a terminal only via the mise shims dir after a reshim.
 * npm can report "added N packages" while no shell can run `unvibe`.
 *
 * Pure assessment with injected paths/existence so it is testable
 * without a real shell; callers supply the interactive-shell PATH dirs
 * (login/interactive probe) and the installed CLI path. Detection only:
 * setup/doctor print the exact fix, they do not edit PATH or create
 * symlinks on their own — that choice stays with the owner.
 */
import fs from "node:fs";
import path from "node:path";

/** `fs.realpathSync` that keeps the input when it cannot resolve. */
export function canonicalizeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export interface BinReachability {
  /** CLI sits under `<prefix>/lib/node_modules/unvibe/...`. */
  installedLayout: boolean;
  /** npm global bin dir for this install (`<prefix>/bin`). */
  binDir: string;
  /** The installed bin itself (`<binDir>/unvibe`). */
  unvibeBin: string;
  /** True when a fresh shell can run `unvibe` by name. */
  reachable: boolean;
  /** How it is reachable: prefix bin on PATH, mise shim present, or another PATH dir holds the bin. */
  via: "prefix-bin" | "mise-shims" | "path" | null;
  /** mise's shims dir for the home (`~/.local/share/mise/shims`). */
  shimsDir: string;
}

/** `<prefix>/bin` from a CLI path in the installed layout, else null. */
export function prefixBinDirForCli(cliPath: string): string | null {
  // <prefix>/lib/node_modules/unvibe/packages/service/dist/index.js
  const pkgRoot = path.resolve(path.dirname(cliPath), "..", "..", "..");
  if (path.basename(pkgRoot) !== "unvibe") return null;
  const nodeModules = path.dirname(pkgRoot);
  if (path.basename(nodeModules) !== "node_modules") return null;
  const lib = path.dirname(nodeModules);
  if (path.basename(lib) !== "lib") return null;
  return path.join(path.dirname(lib), "bin");
}

export function assessBinReachability(input: {
  cliPath: string;
  homeDir: string;
  /** Directories on the probed interactive-shell PATH, in order. */
  interactivePathDirs: readonly string[];
  exists: (p: string) => boolean;
  /**
   * Canonicalize a path before comparison (e.g. `fs.realpathSync`).
   * macOS spells the same directory `/var/...` and `/private/var/...`;
   * comparing raw strings there reports a reachable bin as missing.
   */
  canonicalize?: (p: string) => string;
}): BinReachability {
  const canon = (p: string): string => {
    const stripped = p.replace(/\/+$/, "") || p;
    try {
      return input.canonicalize ? input.canonicalize(stripped) : stripped;
    } catch {
      return stripped;
    }
  };
  const shimsDir = path.join(input.homeDir, ".local", "share", "mise", "shims");
  const binDir = prefixBinDirForCli(input.cliPath);
  if (binDir === null) {
    return { installedLayout: false, binDir: "", unvibeBin: "", reachable: true, via: null, shimsDir };
  }
  const unvibeBin = path.join(binDir, "unvibe");
  const dirs = input.interactivePathDirs.map(canon);
  const normBin = canon(binDir);
  let via: BinReachability["via"] = null;
  if (dirs.includes(normBin)) {
    via = "prefix-bin";
  } else if (dirs.includes(canon(shimsDir)) && input.exists(path.join(shimsDir, "unvibe"))) {
    via = "mise-shims";
  } else if (dirs.some((d) => input.exists(path.join(d, "unvibe")))) {
    via = "path";
  }
  return { installedLayout: true, binDir, unvibeBin, reachable: via !== null, via, shimsDir };
}

/** The exact fix, line by line, when the bin is not reachable. */
export function binReachabilityAdvice(r: BinReachability): string[] {
  if (!r.installedLayout || r.reachable) return [];
  return [
    `\`unvibe\` is installed at ${r.unvibeBin} but that directory is not on your shell PATH, so a fresh terminal cannot run \`unvibe\`.`,
    `Fix: add ${r.binDir} to your PATH (for zsh: echo 'export PATH="${r.binDir}:$PATH"' >> ~/.zshrc, then open a new terminal).`,
    `With mise-managed Node: run \`mise reshim\` and make sure ${r.shimsDir} is on your PATH (that is what \`mise activate\` sets up; a per-directory Node version can also change which prefix npm installs into).`,
    `Or symlink it somewhere already on your PATH, e.g. ln -s ${r.unvibeBin} ~/.local/bin/unvibe when ~/.local/bin is on your PATH.`,
  ];
}
