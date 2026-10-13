/**
 * D2 render cache (content-addressed by diagram hash).
 *
 * Storage: files under `<dataDir>/diagrams/<hash>.v<POSTPROCESS_VERSION>.<theme>.svg`
 * (survives restart) plus an in-memory copy for the running process.
 * Bounded: pruned to `MAX_CACHED_DIAGRAMS` entries (oldest mtime first).
 * The postprocess version in the filename is the cache key's sanitiser
 * half: renders cached by an older `postProcessSvg` are never served
 * stale. Fixture seeds keep the unversioned layout (they
 * ship with the code, so they are always current by construction).
 *
 * Seed: `fixtures/urllib3-5020/diagrams/<hash>.<theme>.svg` ships
 * pre-rendered SVGs for the demo; the cache falls back to the fixtures dir
 * so the demo shows diagrams on a machine without `d2`.
 */
import fs from "node:fs";
import path from "node:path";
import { DIAGRAM_POSTPROCESS_VERSION } from "@unvibe/shared";

export type DiagramTheme = "light" | "dark";

export const MAX_CACHED_DIAGRAMS = 100;

function fileFor(dir: string, hash: string, theme: DiagramTheme): string {
  return path.join(dir, `${hash}.v${DIAGRAM_POSTPROCESS_VERSION}.${theme}.svg`);
}

export class DiagramCache {
  private readonly dir: string;
  private readonly fixturesDiagramsDir: string | null;
  private readonly mem = new Map<string, string>();

  constructor(opts: { dataDir: string; fixturesDir?: string }) {
    this.dir = path.join(opts.dataDir, "diagrams");
    this.fixturesDiagramsDir = opts.fixturesDir ? path.join(opts.fixturesDir, "diagrams") : null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // best effort; gets surface as write failures
    }
  }

  private key(hash: string, theme: DiagramTheme): string {
    return `${hash}.${theme}`;
  }

  /** Get cached SVG (memory → disk → fixture seed). Null when unknown. */
  get(hash: string, theme: DiagramTheme): string | null {
    const k = this.key(hash, theme);
    const hit = this.mem.get(k);
    if (hit !== undefined) return hit;
    const file = fileFor(this.dir, hash, theme);
    try {
      const text = fs.readFileSync(file, "utf8");
      this.mem.set(k, text);
      return text;
    } catch {
      // miss → try fixture seed
    }
    if (this.fixturesDiagramsDir) {
      try {
        const seeded = fs.readFileSync(path.join(this.fixturesDiagramsDir, `${hash}.${theme}.svg`), "utf8");
        // Promote into the live cache (survives restart from here on).
        try {
          fs.writeFileSync(file, seeded);
        } catch {
          // best effort
        }
        this.mem.set(k, seeded);
        return seeded;
      } catch {
        // no seed
      }
    }
    return null;
  }

  /** Store rendered SVG (memory + disk). Best-effort; never throws. */
  put(hash: string, theme: DiagramTheme, svg: string): void {
    const k = this.key(hash, theme);
    this.mem.set(k, svg);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(fileFor(this.dir, hash, theme), svg);
    } catch {
      // best effort
    }
    this.prune();
  }

  /** True when both themes are cached (or seedable). */
  has(hash: string): boolean {
    return this.get(hash, "light") !== null && this.get(hash, "dark") !== null;
  }

  private prune(): void {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".svg"));
      // Count distinct hashes (each has up to 2 theme files).
      const hashes = new Set(files.map((f) => f.split(".")[0]));
      if (hashes.size <= MAX_CACHED_DIAGRAMS) return;
      const withMtime = files
        .map((f) => {
          try {
            return { f, t: fs.statSync(path.join(this.dir, f)).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((x): x is { f: string; t: number } => x !== null)
        .sort((a, b) => a.t - b.t);
      // Delete oldest theme files until under the cap.
      let hashCount = hashes.size;
      for (const { f } of withMtime) {
        if (hashCount <= MAX_CACHED_DIAGRAMS) break;
        try {
          fs.rmSync(path.join(this.dir, f));
        } catch {
          // ignore
        }
        // Recount (cheap for small dirs).
        try {
          const remaining = fs.readdirSync(this.dir).filter((x) => x.endsWith(".svg"));
          hashCount = new Set(remaining.map((x) => x.split(".")[0])).size;
        } catch {
          break;
        }
      }
      // Drop pruned entries from memory too.
      for (const k of [...this.mem.keys()]) {
        const [h, theme] = k.split(".");
        try {
          fs.accessSync(fileFor(this.dir, h, theme as DiagramTheme));
        } catch {
          this.mem.delete(k);
        }
      }
    } catch {
      // best effort
    }
  }
}
